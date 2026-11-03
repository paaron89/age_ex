#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { runSmokeCheck, type SmokeResult } from '../core/index.js';

/** Exit codes (see docs/vision.md §5). */
const EXIT_OK = 0;
// const EXIT_CHECKS_FAILED = 1; // used from Phase 3, when link/button checks exist
const EXIT_TOOL_ERROR = 2;

const program = new Command()
  .name('smoke-agent')
  .description('Smoke tests a web page: checks that its links and buttons work.')
  .argument('<url>', 'page to test (https:// is added if no scheme is given)', parseUrl)
  .option('--headed', 'show the browser window instead of running headless', false)
  .showHelpAfterError()
  // Throw instead of exiting, so usage errors get our exit code 2 rather than commander's 1.
  .exitOverride()
  .action(async (url: string, opts: { headed: boolean }) => {
    try {
      const result = await runSmokeCheck(url, { headed: opts.headed });
      printSummary(result);
      process.exitCode = result.page.ok ? EXIT_OK : EXIT_TOOL_ERROR;
    } catch (err) {
      console.error(`\nsmoke-agent crashed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = EXIT_TOOL_ERROR;
    }
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

function printSummary(r: SmokeResult): void {
  const { page } = r;
  const lines = [`\nSmoke check: ${r.url}`];

  if (page.ok) {
    lines.push(`  Page        ${page.status} OK  (${page.loadTimeMs} ms)  "${page.title ?? ''}"`);
  } else if (page.status !== null) {
    lines.push(`  Page        ${page.status} FAILED  (${page.loadTimeMs} ms)`);
  } else {
    lines.push(`  Page        FAILED to load: ${page.error ?? 'unknown error'}`);
  }
  if (page.finalUrl && page.finalUrl !== r.url) lines.push(`  Redirected  ${page.finalUrl}`);

  lines.push(`  Console     ${r.consoleIssues.length} error(s)`);
  for (const issue of r.consoleIssues.slice(0, 5)) lines.push(`                - [${issue.type}] ${issue.message}`);
  if (r.consoleIssues.length > 5) lines.push(`                … and ${r.consoleIssues.length - 5} more`);

  lines.push(`  Duration    ${(r.durationMs / 1000).toFixed(1)} s${r.timedOut ? '  (time budget exceeded)' : ''}`);
  lines.push(`\nResult: ${page.ok ? 'PASS (page loaded)' : 'ERROR (page did not load)'}\n`);

  console.log(lines.join('\n'));
}
