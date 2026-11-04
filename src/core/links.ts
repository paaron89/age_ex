import type { APIRequestContext, Page } from 'playwright';
import type { Deadline } from './deadline.js';
import type { LinkCheck } from './types.js';

/** Max parallel HTTP requests for link checks. */
const CONCURRENCY = 8;
/** Max time for a single link request. */
const REQUEST_TIMEOUT_MS = 8_000;
/** Don't start a new request with less than this left on the deadline. */
const MIN_START_MS = 300;

interface RawLink {
  href: string;
  text: string;
  visible: boolean;
}

/** Collects every `<a href>` on the page and merges duplicates into one {@link LinkCheck} each. */
export async function discoverLinks(page: Page): Promise<LinkCheck[]> {
  const raw: RawLink[] = await page.$$eval('a[href]', (anchors) =>
    anchors.map((a) => {
      const el = a as HTMLAnchorElement;
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      const text = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ');
      return { href: el.href, text: text.slice(0, 80), visible };
    }),
  );

  const pageUrl = new URL(page.url());
  const byKey = new Map<string, LinkCheck>();

  for (const link of raw) {
    let url: URL;
    try {
      url = new URL(link.href);
    } catch {
      continue; // unparsable href; the browser already gave up on it
    }

    let kind: LinkCheck['kind'];
    let key: string;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      kind = 'unsupported';
      key = url.href;
    } else if (url.hash && withoutHash(url) === withoutHash(pageUrl)) {
      kind = 'anchor'; // same-page link like #section
      key = url.href;
    } else {
      kind = 'http';
      key = withoutHash(url); // /page#a and /page#b are the same request
    }

    const existing = byKey.get(key);
    if (existing) {
      existing.occurrences++;
      existing.visible ||= link.visible;
      if (link.text && existing.texts.length < 3 && !existing.texts.includes(link.text)) existing.texts.push(link.text);
      continue;
    }
    byKey.set(key, {
      url: kind === 'http' ? key : url.href,
      kind,
      texts: link.text ? [link.text] : [],
      occurrences: 1,
      visible: link.visible,
      external: kind === 'http' && !isSameSite(url, pageUrl),
      status: 'not-checked',
    });
  }

  return [...byKey.values()];
}

/**
 * Checks same-page anchors and marks non-http links as skipped. These checks read the
 * current page, so run them before anything else (e.g. button clicks) changes it.
 */
export async function checkLocalLinks(page: Page, links: LinkCheck[]): Promise<void> {
  for (const link of links) {
    if (link.kind === 'unsupported') {
      link.status = 'skipped';
      link.message = `Not an http(s) link (${new URL(link.url).protocol}).`;
    } else if (link.kind === 'anchor') {
      await checkAnchor(page, link);
    }
  }
}

/**
 * Checks `http` links with HTTP requests, updating each {@link LinkCheck} in place.
 * Doesn't touch the page, so it can run in parallel with button checks.
 * Stops starting new requests when the deadline is near.
 */
export async function checkHttpLinks(links: LinkCheck[], request: APIRequestContext, deadline: Deadline): Promise<void> {
  const queue = links.filter((l) => l.kind === 'http');
  const worker = async () => {
    for (let link = queue.shift(); link; link = queue.shift()) {
      if (deadline.expired(MIN_START_MS)) {
        link.message = 'Time budget ran out before this link was checked.';
        continue; // stays 'not-checked'
      }
      await checkHttpLink(link, request, deadline);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function checkAnchor(page: Page, link: LinkCheck): Promise<void> {
  const fragment = decodeURIComponent(new URL(link.url).hash.slice(1));
  if (fragment === '' || fragment.toLowerCase() === 'top') {
    link.status = 'pass'; // "#" and "#top" scroll to the top of the page by definition
    return;
  }
  const exists = await page
    .evaluate((id) => !!(document.getElementById(id) || document.getElementsByName(id).length), fragment)
    .catch(() => false);
  link.status = exists ? 'pass' : 'warning';
  if (!exists) link.message = `No element with id or name "${fragment}" on the page.`;
}

async function checkHttpLink(link: LinkCheck, request: APIRequestContext, deadline: Deadline): Promise<void> {
  const t0 = Date.now();
  let outcome = await tryRequest(request, 'HEAD', link.url, deadline);
  // Many servers reject or mishandle HEAD, so retry anything that isn't clearly OK with GET.
  if ((outcome.status === undefined || outcome.status >= 400) && !deadline.expired(MIN_START_MS)) {
    outcome = await tryRequest(request, 'GET', link.url, deadline);
  }
  link.durationMs = Date.now() - t0;
  link.method = outcome.method;

  if (outcome.status !== undefined) {
    link.httpStatus = outcome.status;
    if (outcome.status < 400) {
      link.status = 'pass';
      return;
    }
    if (outcome.status === 401 || outcome.status === 403) {
      // The target exists but needs a login (or blocks bots); that's not a broken link.
      link.status = 'warning';
      link.message = `HTTP ${outcome.status}: requires authentication or blocks automated requests.`;
      return;
    }
    link.message = `HTTP ${outcome.status}`;
  } else {
    link.message = outcome.error ?? 'Request failed.';
  }
  // Broken links to other sites are warnings: third parties often block bots or rate-limit.
  link.status = link.external ? 'warning' : 'fail';
}

async function tryRequest(
  request: APIRequestContext,
  method: 'HEAD' | 'GET',
  url: string,
  deadline: Deadline,
): Promise<{ method: 'HEAD' | 'GET'; status?: number; error?: string }> {
  try {
    const response = await request.fetch(url, {
      method,
      timeout: deadline.timeout(REQUEST_TIMEOUT_MS),
      failOnStatusCode: false,
      maxRedirects: 10,
    });
    const status = response.status();
    await response.dispose();
    return { method, status };
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { method, error: message };
  }
}

function withoutHash(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = '';
  return copy.href;
}

/** Same host, ignoring a leading "www.". */
function isSameSite(a: URL, b: URL): boolean {
  const host = (u: URL) => u.hostname.replace(/^www\./, '');
  return host(a) === host(b);
}
