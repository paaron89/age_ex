import { chromium, errors, type Page } from 'playwright';
import type { ConsoleIssue, PageLoadResult, SmokeOptions, SmokeResult } from './types.js';

export const MAX_TIMEOUT_MS = 60_000;

/**
 * Opens `url` in Chromium and smoke-checks it.
 *
 * Pure library function: no console output, no process.exit. It never throws
 * for page-level problems (they are reported in the result); it only throws if
 * the browser itself cannot be launched.
 */
export async function runSmokeCheck(url: string, options: SmokeOptions = {}): Promise<SmokeResult> {
  const startedAt = new Date();
  const budgetMs = Math.min(options.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = startedAt.getTime() + budgetMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  const consoleIssues: ConsoleIssue[] = [];
  let timedOut = false;

  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleIssues.push({ type: 'console-error', message: msg.text() });
    });
    page.on('pageerror', (err) => {
      consoleIssues.push({ type: 'page-error', message: err.message });
    });

    const { result: pageResult, timedOut: loadTimedOut } = await loadPage(page, url, remaining());
    if (loadTimedOut) timedOut = true;

    // Phase 3 adds link and button checks here, each bounded by remaining().

    return {
      url,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      timedOut,
      browser: 'chromium',
      page: pageResult,
      consoleIssues,
    };
  } finally {
    await browser.close();
  }
}

async function loadPage(
  page: Page,
  url: string,
  timeoutMs: number,
): Promise<{ result: PageLoadResult; timedOut: boolean }> {
  const t0 = Date.now();
  try {
    // Playwright treats timeout 0 as "no timeout", so never pass 0.
    const response = await page.goto(url, { waitUntil: 'load', timeout: Math.max(1, timeoutMs) });
    const loadTimeMs = Date.now() - t0;
    const status = response?.status() ?? null;
    return {
      timedOut: false,
      result: {
        ok: status !== null && status < 400,
        status,
        finalUrl: page.url(),
        title: await page.title().catch(() => null),
        loadTimeMs,
      },
    };
  } catch (err) {
    return {
      timedOut: err instanceof errors.TimeoutError,
      result: {
        ok: false,
        status: null,
        finalUrl: null,
        title: null,
        loadTimeMs: Date.now() - t0,
        error: err instanceof Error ? firstLine(err.message) : String(err),
      },
    };
  }
}

function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}
