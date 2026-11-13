#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_MODEL,
  createClaudeButtonReviewer,
  createClaudeClient,
  hasClaudeCredentials,
  triageWithClaude,
} from '../ai/index.js';
import { MAX_TIMEOUT_MS, runSmokeCheck, type SmokeResult } from '../core/index.js';
import { renderHtmlReport } from '../reporter/index.js';
import { printSummary, type SavedFiles } from './printSummary.js';

/** Exit codes (see docs/vision.md §5). */
const EXIT_OK = 0;
const EXIT_CHECKS_FAILED = 1;
const EXIT_TOOL_ERROR = 2;

const REPORTS_DIR = 'reports';
/** Below this there's no time left for checks after loading the page and the cleanup reserve. */
const MIN_TIMEOUT_S = 5;
/** With --ai: the minimum total budget, and the part of it kept free for the post-run AI triage. */
const MIN_AI_TIMEOUT_S = 20;
const AI_TRIAGE_RESERVE_MS = 20_000;

const program = new Command()
  .name('smoke-agent')
  .description('Smoke tests a web page: checks that its links and buttons work.')
  .argument('<url>', 'page to test (https:// is added if no scheme is given)', parseUrl)
  .option('--headed', 'show the browser window instead of running headless', false)
  .option(
    '-t, --timeout <seconds>',
    `max run time in seconds (${MIN_TIMEOUT_S}–${MAX_TIMEOUT_MS / 1000})`,
    parseTimeout,
    MAX_TIMEOUT_MS / 1000,
  )
  .option(
    '-o, --out <path>',
    `folder for the report, or a file ending in .html (default: ${REPORTS_DIR}/); the JSON is saved next to it`,
  )
  .option(
    '--ai',
    `add an AI review with Claude (${AI_MODEL}): flags risky buttons by context before clicking, ` +
      'triages warnings and writes a summary. Needs ANTHROPIC_API_KEY. Advisory only: never changes the exit code',
    false,
  )
  .showHelpAfterError()
  // Throw instead of exiting, so usage errors get our exit code 2 rather than commander's 1.
  .exitOverride()
  .action(async (url: string, opts: { headed: boolean; timeout: number; out?: string; ai: boolean }) => {
    const startedAt = Date.now();
    const totalMs = opts.timeout * 1000;

    let client: Anthropic | undefined;
    if (opts.ai) {
      if (opts.timeout < MIN_AI_TIMEOUT_S) {
        console.error(`error: --ai needs --timeout of at least ${MIN_AI_TIMEOUT_S} seconds (got ${opts.timeout}).`);
        process.exitCode = EXIT_TOOL_ERROR;
        return;
      }
      if (!hasClaudeCredentials()) {
        console.error(
          'error: --ai needs Claude API credentials. Set ANTHROPIC_API_KEY (get a key at https://console.anthropic.com),\n' +
            '       e.g. in PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."',
        );
        process.exitCode = EXIT_TOOL_ERROR;
        return;
      }
      client = createClaudeClient();
    }

    let result: SmokeResult;
    try {
      result = await runSmokeCheck(url, {
        headed: opts.headed,
        // With --ai, keep time free for the triage call at the end.
        timeoutMs: client ? totalMs - AI_TRIAGE_RESERVE_MS : totalMs,
        ...(client ? { buttonRiskReviewer: createClaudeButtonReviewer(client) } : {}),
      });
    } catch (err) {
      console.error(`\nsmoke-agent crashed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = EXIT_TOOL_ERROR;
      return;
    }

    if (client && result.page.ok) {
      // The triage gets whatever is left of the total budget (usually much more than the reserve).
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(0, totalMs - (Date.now() - startedAt) - 1_000));
      try {
        await triageWithClaude(client, result, controller.signal);
      } finally {
        clearTimeout(timer);
      }
      result.ai = { ...result.ai, model: AI_MODEL };
      result.durationMs = Date.now() - startedAt; // include the AI time
    }

    let saved: SavedFiles | null = null;
    try {
      saved = await writeOutputs(result, opts.out);
    } catch (err) {
      console.error(`\nCould not save the report: ${err instanceof Error ? err.message : String(err)}`);
    }

    printSummary(result, saved);

    if (!result.page.ok || saved === null) process.exitCode = EXIT_TOOL_ERROR;
    else if (result.summary.total.fail > 0) process.exitCode = EXIT_CHECKS_FAILED;
    else process.exitCode = EXIT_OK;
  });

try {
  await program.parseAsync();
} catch (err) {
  if (!(err instanceof CommanderError)) throw err;
  // --help / --version exit with 0; real usage errors (bad URL, missing argument) are tool errors.
  process.exitCode = err.exitCode === 0 ? EXIT_OK : EXIT_TOOL_ERROR;
}

function parseUrl(value: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new InvalidArgumentError(`"${value}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidArgumentError(`Only http and https URLs are supported (got "${parsed.protocol}").`);
  }
  return parsed.href;
}

function parseTimeout(value: string): number {
  const seconds = Number(value);
  const max = MAX_TIMEOUT_MS / 1000;
  if (!Number.isFinite(seconds) || seconds < MIN_TIMEOUT_S || seconds > max) {
    throw new InvalidArgumentError(`Must be a number of seconds between ${MIN_TIMEOUT_S} and ${max}.`);
  }
  return seconds;
}

/**
 * Saves the HTML report and the results JSON side by side.
 * Default: reports/<host>-<timestamp>.html/.json. With --out: a path ending in .html is used as the
 * report file (JSON gets the same name); any other path is a folder that gets the default file names.
 */
async function writeOutputs(result: SmokeResult, out?: string): Promise<SavedFiles> {
  const host = new URL(result.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
  const defaultName = `${host}-${localTimestamp(new Date(result.startedAt))}.html`;
  // --out ending in .html/.htm is the report file; anything else is a folder for the default file names.
  const html = out && /\.html?$/i.test(out) ? out : path.join(out ?? REPORTS_DIR, defaultName);
  const json = html.replace(/\.html?$/i, '.json');

  await mkdir(path.dirname(path.resolve(html)), { recursive: true });
  await writeFile(json, JSON.stringify(result, null, 2) + '\n', 'utf8');
  await writeFile(html, renderHtmlReport(result), 'utf8');
  return { html, json };
}

/** e.g. 2026-11-04_14-05-22 (local time, safe for file names). */
function localTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
