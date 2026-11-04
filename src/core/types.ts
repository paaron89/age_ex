/** Options accepted by {@link runSmokeCheck}. */
export interface SmokeOptions {
  /** Show the browser window instead of running headless. Default: false. */
  headed?: boolean;
  /** Hard limit for the whole run, in milliseconds. Default and maximum: 60 000. */
  timeoutMs?: number;
}

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
}

/** The full result of a smoke run. Serializable to JSON. */
export interface SmokeResult {
  url: string;
  /** ISO timestamp of when the run started. */
  startedAt: string;
  /** Wall-clock duration of the whole run, in milliseconds. */
  durationMs: number;
  /** True if the global time budget ran out before all work finished. */
  timedOut: boolean;
  browser: 'chromium';
  page: PageLoadResult;
  consoleIssues: ConsoleIssue[];
}
