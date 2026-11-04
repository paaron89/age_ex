import { chromium, errors, request as playwrightRequest, type Page } from 'playwright';
import { checkButtons, discoverButtons } from './buttons.js';
import { Deadline } from './deadline.js';
import { checkHttpLinks, checkLocalLinks, discoverLinks } from './links.js';
import { PageObserver } from './observer.js';
import { DEFAULT_RISKY_KEYWORDS } from './risky.js';
import type { ButtonCheck, CheckStatus, LinkCheck, PageLoadResult, SmokeOptions, SmokeResult, StatusCounts } from './types.js';

export const MAX_TIMEOUT_MS = 60_000;
/** Time kept free at the end of the budget for closing the browser and writing results. */
const CLEANUP_RESERVE_MS = 3_000;

/**
 * Opens `url` in Chromium and smoke-checks it: loads the page, checks every link
 * over HTTP and clicks every safe, visible button, all within the time budget.
 *
 * Pure library function: no console output, no process.exit. It never throws
 * for page-level problems (they are reported in the result); it only throws if
 * the browser itself cannot be launched.
 */
export async function runSmokeCheck(url: string, options: SmokeOptions = {}): Promise<SmokeResult> {
  const startedAt = Date.now();
  const budgetMs = Math.min(options.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const deadline = new Deadline(budgetMs - CLEANUP_RESERVE_MS, startedAt);
  const riskyKeywords = options.riskyKeywords ?? DEFAULT_RISKY_KEYWORDS;

  let links: LinkCheck[] = [];
  let buttons: ButtonCheck[] = [];

  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const observer = new PageObserver(context, page);

    const { result: pageResult, timedOut: loadTimedOut } = await loadPage(page, url, deadline);

    if (pageResult.ok && !deadline.expired()) {
      links = await discoverLinks(page);
      buttons = await discoverButtons(page, riskyKeywords);
      await checkLocalLinks(page, links);

      // Link requests use their own request context: they don't share cookies with the
      // browser (so e.g. a GET to a logout link can't end the page's session) and don't
      // show up as network activity of button clicks.
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const linkRequests = await playwrightRequest.newContext({ userAgent });
      try {
        await Promise.all([
          checkHttpLinks(links, linkRequests, deadline),
          checkButtons(page, buttons, observer, deadline),
        ]);
      } finally {
        await linkRequests.dispose();
      }
    }

    const notChecked = [...links, ...buttons].some((c) => c.status === 'not-checked');
    return {
      url,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      timedOut: loadTimedOut || notChecked,
      browser: 'chromium',
      page: pageResult,
      links,
      buttons,
      consoleIssues: observer.consoleIssues,
      summary: {
        links: countStatuses(links),
        buttons: countStatuses(buttons),
        total: countStatuses([...links, ...buttons]),
      },
    };
  } finally {
    await browser.close();
  }
}

async function loadPage(
  page: Page,
  url: string,
  deadline: Deadline,
): Promise<{ result: PageLoadResult; timedOut: boolean }> {
  const t0 = Date.now();
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: deadline.timeout(Infinity) });
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

function countStatuses(checks: { status: CheckStatus }[]): StatusCounts {
  const counts: StatusCounts = { total: checks.length, pass: 0, warning: 0, fail: 0, skipped: 0, 'not-checked': 0 };
  for (const c of checks) counts[c.status]++;
  return counts;
}

function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}
