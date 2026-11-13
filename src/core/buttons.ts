import type { Page } from 'playwright';
import type { Deadline } from './deadline.js';
import type { PageObserver } from './observer.js';
import { matchRiskyKeyword } from './risky.js';
import type { ButtonCheck, ButtonReaction, ButtonRiskCandidate, ButtonRiskVerdict } from './types.js';

/** Elements treated as buttons. `<a href role="button">` is excluded: it's checked as a link. */
export const BUTTON_SELECTOR =
  'button, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"], [role="button"]:not(a[href])';

/** Max time to wait for a button to become clickable. */
const CLICK_TIMEOUT_MS = 3_000;
/** How long to watch for a reaction after a click. */
const SETTLE_MS = 700;
/** Max time to wait for a page load after a click navigates. */
const NAV_LOAD_TIMEOUT_MS = 5_000;
/** Max time to restore the original page between clicks. */
const RESTORE_TIMEOUT_MS = 15_000;
/** Don't start a click with less than this left on the deadline. */
const MIN_START_MS = 2_000;

interface ButtonSnapshot {
  label: string;
  selector: string;
  visible: boolean;
  disabled: boolean;
  /** Where the button sits on the page (form, nearest heading, landmark), for reviewers. */
  context: string;
}

/**
 * Lists all button-like elements, in DOM order.
 * The callback runs inside the browser, so it must be self-contained: no outside helpers,
 * and no named inner functions (tsx/esbuild wraps those in a `__name()` helper that
 * doesn't exist in the page).
 */
async function snapshotButtons(page: Page): Promise<ButtonSnapshot[]> {
  return page.locator(BUTTON_SELECTOR).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement & { value?: string; disabled?: boolean; alt?: string; name?: string };
      const candidates = [h.getAttribute('aria-label'), h.innerText, h.value, h.title, h.alt, h.name];
      let label = '';
      for (const c of candidates) {
        label = (c ?? '').trim().replace(/\s+/g, ' ');
        if (label) break;
      }
      if (!label) label = h.id ? `#${h.id}` : '(no label)';

      const tag = h.tagName.toLowerCase();
      let selector = tag;
      if (h.id) selector += `#${CSS.escape(h.id)}`;
      else {
        const classes = [...h.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
        selector += classes;
        const type = h.getAttribute('type');
        if (tag === 'input' && type) selector += `[type="${type}"]`;
      }

      const rect = h.getBoundingClientRect();
      const visible =
        rect.width > 0 && rect.height > 0 && h.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const disabled = !!h.disabled || h.getAttribute('aria-disabled') === 'true';

      // Context for reviewers: type, enclosing form, landmark area and the nearest heading above.
      const parts: string[] = [];
      const type = h.getAttribute('type');
      if (type) parts.push(`type="${type}"`);
      const form = h.closest('form');
      if (form) parts.push(`in form action="${form.getAttribute('action') ?? ''}" method="${form.getAttribute('method') ?? 'get'}"`);
      const area = h.closest('nav, header, footer, aside, dialog, [role="dialog"]');
      if (area) parts.push(`inside <${area.tagName.toLowerCase()}>`);
      let heading = '';
      for (const hd of document.querySelectorAll('h1, h2, h3, h4')) {
        if (hd.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) heading = (hd.textContent ?? '').trim();
        else break;
      }
      if (heading) parts.push(`under heading "${heading.replace(/\s+/g, ' ').slice(0, 60)}"`);

      return { label: label.slice(0, 80), selector, visible, disabled, context: parts.join('; ') };
    }),
  );
}

/**
 * Finds all button-like elements and decides which ones to click.
 * Risky, hidden and disabled buttons are marked `skipped`; the rest are `not-checked` until clicked.
 */
export async function discoverButtons(
  page: Page,
  riskyKeywords: readonly string[],
): Promise<{ buttons: ButtonCheck[]; candidates: ButtonRiskCandidate[] }> {
  const snapshot = await snapshotButtons(page);
  const buttons = snapshot.map((b, index): ButtonCheck => {
    const base = { index, label: b.label, selector: b.selector };
    const keyword = matchRiskyKeyword(b.label, riskyKeywords);
    if (keyword) {
      return {
        ...base,
        status: 'skipped',
        skipReason: 'risky',
        matchedKeyword: keyword,
        message: `Not clicked: label matches risky keyword "${keyword}". Check manually.`,
      };
    }
    if (!b.visible) return { ...base, status: 'skipped', skipReason: 'not-visible', message: 'Not visible on the page.' };
    if (b.disabled) return { ...base, status: 'skipped', skipReason: 'disabled', message: 'Button is disabled.' };
    return { ...base, status: 'not-checked' };
  });

  // Buttons worth showing to a reviewer: the ones we'd click, plus the keyword-skipped ones (for an opinion).
  const candidates: ButtonRiskCandidate[] = buttons
    .filter((b) => b.status === 'not-checked' || b.skipReason === 'risky')
    .map((b) => ({
      index: b.index,
      label: b.label,
      selector: b.selector,
      context: snapshot[b.index]!.context,
      ...(b.matchedKeyword ? { keywordMatch: b.matchedKeyword } : {}),
    }));

  return { buttons, candidates };
}

/**
 * Applies a reviewer's verdicts. A reviewer can only ADD skips: a `risky` verdict on a button
 * we'd click marks it `skipped` (`ai-risky`); on a keyword-skipped button any verdict is only
 * recorded as an opinion. Verdicts for unknown indexes are ignored. Returns the number of skips added.
 */
export function applyRiskVerdicts(
  buttons: ButtonCheck[],
  candidates: ButtonRiskCandidate[],
  verdicts: ButtonRiskVerdict[],
): number {
  const allowed = new Set(candidates.map((c) => c.index));
  let added = 0;
  for (const v of verdicts) {
    if (!allowed.has(v.index)) continue;
    const button = buttons[v.index];
    if (!button) continue;
    if (button.skipReason === 'risky') {
      button.ai = { verdict: v.risky ? 'risky' : 'safe', reason: v.reason };
    } else if (button.status === 'not-checked' && v.risky) {
      button.status = 'skipped';
      button.skipReason = 'ai-risky';
      button.ai = { verdict: 'risky', reason: v.reason };
      button.message = `Not clicked: the AI review judged it risky (${v.reason}). Check manually.`;
      added++;
    }
  }
  return added;
}

/**
 * Clicks each `not-checked` button one at a time and classifies the result:
 * - fail: uncaught JS error, not clickable, or navigated to a 4xx/5xx page
 * - pass: no error and some reaction (navigation, popup, dialog, download, DOM change, network request)
 * - warning: no error but no reaction
 *
 * After a click that changed the page, the original page is reloaded so every
 * button is tested from the same starting state.
 */
export async function checkButtons(
  page: Page,
  buttons: ButtonCheck[],
  observer: PageObserver,
  deadline: Deadline,
): Promise<void> {
  const originalUrl = page.url();
  let current = await snapshotButtons(page);
  let needsRestore = false;

  for (const button of buttons) {
    if (button.status !== 'not-checked') continue;

    if (deadline.expired(MIN_START_MS)) {
      button.message = 'Time budget ran out before this button was checked.';
      continue;
    }

    if (needsRestore) {
      try {
        await page.goto(originalUrl, { waitUntil: 'load', timeout: deadline.timeout(RESTORE_TIMEOUT_MS) });
        current = await snapshotButtons(page);
        needsRestore = false;
      } catch (err) {
        button.message = `Could not reload the page before clicking: ${firstLine(err)}`;
        continue; // stays 'not-checked'; the next button tries to restore again
      }
    }

    // The page must still have the same button at the same position.
    if (current[button.index]?.label !== button.label) {
      button.status = 'skipped';
      button.skipReason = 'changed-after-reload';
      button.message = 'The button was no longer found at the same place after reloading the page.';
      continue;
    }

    needsRestore = await clickAndObserve(page, button, observer, deadline);
  }
}

/** Clicks one button and records the result on it. Returns true if the page changed and must be restored. */
async function clickAndObserve(
  page: Page,
  button: ButtonCheck,
  observer: PageObserver,
  deadline: Deadline,
): Promise<boolean> {
  const locator = page.locator(BUTTON_SELECTOR).nth(button.index);
  const t0 = Date.now();

  let obs;
  try {
    // Count DOM mutations outside the button itself (ignores hover/focus/ripple effects on the button).
    await locator.evaluate(
      (target) => {
        const w = window as unknown as { __smokeMut: number; __smokeObs?: MutationObserver };
        w.__smokeObs?.disconnect();
        w.__smokeMut = 0;
        w.__smokeObs = new MutationObserver((records) => {
          for (const r of records) {
            const node = r.target instanceof Element ? r.target : r.target.parentElement;
            if (!node || !target.contains(node)) w.__smokeMut++;
          }
        });
        w.__smokeObs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      },
      undefined,
      { timeout: deadline.timeout(CLICK_TIMEOUT_MS) },
    );

    obs = observer.start(button.label);
    await locator.click({ timeout: deadline.timeout(CLICK_TIMEOUT_MS) });
  } catch (err) {
    observer.stop();
    button.durationMs = Date.now() - t0;
    if (deadline.expired(MIN_START_MS / 2)) {
      button.message = 'Time budget ran out while clicking.';
      return false; // stays 'not-checked'
    }
    button.status = 'fail';
    button.message = `Could not click: ${firstLine(err)}`;
    return false;
  }

  await page.waitForTimeout(Math.min(SETTLE_MS, deadline.remaining()));
  if (obs.navigation) {
    await page.waitForLoadState('load', { timeout: deadline.timeout(NAV_LOAD_TIMEOUT_MS) }).catch(() => {});
  }
  // After a navigation this runs in the new document, where the counter doesn't exist.
  const mutations = await page
    .evaluate(() => (window as unknown as { __smokeMut?: number }).__smokeMut ?? 0)
    .catch(() => 0);
  observer.stop();
  button.durationMs = Date.now() - t0;

  const reactions: ButtonReaction[] = [];
  if (obs.navigation) reactions.push('navigation');
  if (obs.popup) reactions.push('popup');
  if (obs.dialog) reactions.push('dialog');
  if (obs.download) reactions.push('download');
  if (mutations > 0) reactions.push('dom-change');
  if (obs.requests > 0) reactions.push('network-request');
  button.reactions = reactions;
  if (obs.navigation) button.navigatedTo = obs.navigation;

  if (obs.pageErrors.length > 0) {
    button.status = 'fail';
    button.message = `JavaScript error after click: ${obs.pageErrors[0]}`;
  } else if (obs.navigation?.status != null && obs.navigation.status >= 400) {
    button.status = 'fail';
    button.message = `Navigated to ${obs.navigation.url}, which returned HTTP ${obs.navigation.status}.`;
  } else if (reactions.length > 0) {
    button.status = 'pass';
  } else {
    button.status = 'warning';
    button.message = 'No visible reaction: no navigation, DOM change, network request or dialog.';
  }

  return reactions.includes('navigation') || reactions.includes('dom-change');
}

function firstLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split('\n')[0] ?? message;
}
