import { chromium, errors, request as playwrightRequest, type Page } from 'playwright';
import { applyRiskVerdicts, checkButtons, discoverButtons } from './buttons.js';
import { Deadline } from './deadline.js';
import { checkHttpLinks, checkLocalLinks, discoverLinks } from './links.js';
import { PageObserver } from './observer.js';
import { DEFAULT_RISKY_KEYWORDS } from './risky.js';
import type {
  AiAnalysis,
  ButtonCheck,
  ButtonRiskCandidate,
  ButtonRiskReviewer,
  CheckStatus,
  LinkCheck,
  PageLoadResult,
  SmokeOptions,
  SmokeResult,
  StatusCounts,
} from './types.js';

export const MAX_TIMEOUT_MS = 60_000;
/** Time kept free at the end of the budget for closing the browser and writing results. */
const CLEANUP_RESERVE_MS = 3_000;
/** Max time the optional button reviewer may take; button clicks wait for it. */
const REVIEW_TIMEOUT_MS = 20_000;

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
  let buttonReview: AiAnalysis['buttonReview'];

  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const observer = new PageObserver(context, page);

    const { result: pageResult, timedOut: loadTimedOut } = await loadPage(page, url, deadline);

    if (pageResult.ok && !deadline.expired()) {
      links = await discoverLinks(page);
      const discovered = await discoverButtons(page, riskyKeywords);
      buttons = discovered.buttons;
      await checkLocalLinks(page, links);

      // Link requests use their own request context: they don't share cookies with the
      // browser (so e.g. a GET to a logout link can't end the page's session) and don't
      // show up as network activity of button clicks.
      const userAgent = await page.evaluate(() => navigator.userAgent);
      const linkRequests = await playwrightRequest.newContext({ userAgent });
      try {
        // Buttons wait for the optional reviewer (it may add skips); links don't need to.
        const buttonsTask = async () => {
          if (options.buttonRiskReviewer && discovered.candidates.length > 0) {
            buttonReview = await reviewButtons(
              options.buttonRiskReviewer,
              { url: page.url(), title: pageResult.title ?? '', buttons: discovered.candidates },
              buttons,
              deadline,
            );
          }
          await checkButtons(page, buttons, observer, deadline);
        };
        await Promise.all([checkHttpLinks(links, linkRequests, deadline), buttonsTask()]);
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
      ...(buttonReview ? { ai: { buttonReview } } : {}),
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

/** Runs the reviewer with a time limit and applies its verdicts. Never throws. */
async function reviewButtons(
  reviewer: ButtonRiskReviewer,
  input: { url: string; title: string; buttons: ButtonRiskCandidate[] },
  buttons: ButtonCheck[],
  deadline: Deadline,
): Promise<NonNullable<AiAnalysis['buttonReview']>> {
  const t0 = Date.now();
  const controller = new AbortController();
  // Leave at least a few seconds for clicking after the review.
  const timer = setTimeout(() => controller.abort(), Math.max(0, Math.min(REVIEW_TIMEOUT_MS, deadline.remaining() - 5_000)));
  try {
    const verdicts = await reviewer(input, controller.signal);
    const addedSkips = applyRiskVerdicts(buttons, input.buttons, verdicts);
    return { ok: true, durationMs: Date.now() - t0, reviewed: input.buttons.length, addedSkips };
  } catch (err) {
    const error = controller.signal.aborted ? 'Timed out; continued with the keyword list only.' : errorMessage(err);
    return { ok: false, durationMs: Date.now() - t0, reviewed: 0, addedSkips: 0, error };
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? firstLine(err.message) : String(err);
}

function countStatuses(checks: { status: CheckStatus }[]): StatusCounts {
  const counts: StatusCounts = { total: checks.length, pass: 0, warning: 0, fail: 0, skipped: 0, 'not-checked': 0 };
  for (const c of checks) counts[c.status]++;
  return counts;
}

function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}
