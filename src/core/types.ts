/** Options accepted by {@link runSmokeCheck}. */
export interface SmokeOptions {
  /** Show the browser window instead of running headless. Default: false. */
  headed?: boolean;
  /** Hard limit for the whole run, in milliseconds. Default and maximum: 60 000. */
  timeoutMs?: number;
  /** Buttons whose label matches one of these words are not clicked. Default: {@link DEFAULT_RISKY_KEYWORDS}. */
  riskyKeywords?: string[];
}

/** Outcome of a single check. */
export type CheckStatus = 'pass' | 'warning' | 'fail' | 'skipped' | 'not-checked';

/** Result of loading the target page. */
export interface PageLoadResult {
  /** True if navigation succeeded and the main document returned a 2xx/3xx status. */
  ok: boolean;
  /** HTTP status of the main document, or null if no response was received. */
  status: number | null;
  /** URL after redirects. */
  finalUrl: string | null;
  title: string | null;
  /** Time until the `load` event, in milliseconds. */
  loadTimeMs: number;
  /** Navigation error message (DNS failure, timeout, …), if any. */
  error?: string;
}

/** A console error or uncaught exception seen on the page. */
export interface ConsoleIssue {
  type: 'console-error' | 'page-error';
  message: string;
  /** Label of the button being clicked when the issue happened; absent if it happened during page load. */
  duringClickOf?: string;
}

export type LinkKind = 'http' | 'anchor' | 'unsupported';

/** One unique link target found on the page (duplicates are merged). */
export interface LinkCheck {
  /** Absolute URL as resolved by the browser. */
  url: string;
  kind: LinkKind;
  /** Up to 3 distinct link texts that point to this URL. */
  texts: string[];
  /** How many `<a href>` elements on the page point to this URL. */
  occurrences: number;
  /** True if at least one occurrence is visible. */
  visible: boolean;
  /** True if the link points to a different site than the page. */
  external: boolean;
  status: CheckStatus;
  /** Final HTTP status, for `http` links that were requested. */
  httpStatus?: number;
  /** HTTP method of the final request (HEAD, or GET as a fallback). */
  method?: 'HEAD' | 'GET';
  durationMs?: number;
  /** Why the check failed, warned, or was skipped. */
  message?: string;
}

export type ButtonSkipReason = 'risky' | 'not-visible' | 'disabled' | 'changed-after-reload';

/** Signals observed after clicking a button. */
export type ButtonReaction = 'navigation' | 'popup' | 'dialog' | 'download' | 'dom-change' | 'network-request';

/** One clickable button-like element on the page. */
export interface ButtonCheck {
  /** Position among all button-like elements on the page (0-based). */
  index: number;
  /** Visible text, aria-label, value or title of the button. */
  label: string;
  /** A human-readable CSS-like selector to help find the element. */
  selector: string;
  status: CheckStatus;
  skipReason?: ButtonSkipReason;
  /** For `risky` skips: the denylist keyword that matched. */
  matchedKeyword?: string;
  /** What happened after the click. */
  reactions?: ButtonReaction[];
  /** For navigations: where the click led and the HTTP status of that page. */
  navigatedTo?: { url: string; status: number | null };
  durationMs?: number;
  message?: string;
}

/** Number of checks per status. */
export type StatusCounts = Record<CheckStatus, number> & { total: number };

/** The full result of a smoke run. Serializable to JSON. */
export interface SmokeResult {
  url: string;
  /** ISO timestamp of when the run started. */
  startedAt: string;
  /** Wall-clock duration of the whole run, in milliseconds. */
  durationMs: number;
  /** True if the time budget ran out before all checks finished (see `not-checked` items). */
  timedOut: boolean;
  browser: 'chromium';
  page: PageLoadResult;
  links: LinkCheck[];
  buttons: ButtonCheck[];
  consoleIssues: ConsoleIssue[];
  summary: { links: StatusCounts; buttons: StatusCounts; total: StatusCounts };
}
