/** Options accepted by {@link runSmokeCheck}. */
export interface SmokeOptions {
  /** Show the browser window instead of running headless. Default: false. */
  headed?: boolean;
  /** Hard limit for the whole run, in milliseconds. Default and maximum: 60 000. */
  timeoutMs?: number;
  /** Buttons whose label matches one of these words are not clicked. Default: {@link DEFAULT_RISKY_KEYWORDS}. */
  riskyKeywords?: string[];
  /**
   * Optional reviewer (e.g. an AI) that looks at the buttons before any is clicked.
   * It can only ADD buttons to the skip list; buttons skipped by keyword are never unblocked.
   * If it throws or times out, the run continues with the keyword list only.
   */
  buttonRiskReviewer?: ButtonRiskReviewer;
}

/** One button as shown to a {@link ButtonRiskReviewer}. */
export interface ButtonRiskCandidate {
  index: number;
  label: string;
  selector: string;
  /** Where the button sits on the page, e.g. `in form action="/checkout"; under heading "Payment"`. */
  context: string;
  /** Set if the keyword denylist already skips this button. */
  keywordMatch?: string;
}

export interface ButtonRiskVerdict {
  index: number;
  risky: boolean;
  reason: string;
}

/** Reviews buttons before clicking. Must honour `signal` (aborted when its time is up). */
export type ButtonRiskReviewer = (
  input: { url: string; title: string; buttons: ButtonRiskCandidate[] },
  signal: AbortSignal,
) => Promise<ButtonRiskVerdict[]>;

/** An AI opinion attached to a single check. */
export interface AiNote {
  verdict: 'likely-bug' | 'likely-fine' | 'unsure' | 'risky' | 'safe';
  reason: string;
}

/** Results of the optional AI analysis (`--ai`). Advisory only: never changes statuses or the exit code. */
export interface AiAnalysis {
  /** The model used (set by the AI module; absent if only the core's button review ran). */
  model?: string;
  /** Plain-language summary of the run, for the report. */
  summary?: string;
  /** Short, concrete next steps for the tester. */
  recommendations?: string[];
  /** How the pre-click button review went. */
  buttonReview?: { ok: boolean; durationMs: number; reviewed: number; addedSkips: number; error?: string };
  /** How the post-run triage went. */
  triage?: { ok: boolean; durationMs: number; error?: string };
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
  /** AI triage of a warning (with `--ai`). */
  ai?: AiNote;
}

/** `risky` = keyword denylist; `ai-risky` = the AI review judged it risky from page context. */
export type ButtonSkipReason = 'risky' | 'ai-risky' | 'not-visible' | 'disabled' | 'changed-after-reload';

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
  /** AI opinion (with `--ai`): risk review before clicking, or triage of a warning afterwards. */
  ai?: AiNote;
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
  /** Present only when the AI mode was used. */
  ai?: AiAnalysis;
}
