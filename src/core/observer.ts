import type { BrowserContext, Page } from 'playwright';
import type { ConsoleIssue } from './types.js';

/** What happened on the page while one button click was being observed. */
export interface ClickObservation {
  label: string;
  requests: number;
  dialog: boolean;
  popup: boolean;
  download: boolean;
  navigation: { url: string; status: number | null } | null;
  pageErrors: string[];
}

/**
 * Listens to page and context events for the whole run.
 *
 * - Collects console errors and uncaught exceptions (with the button being clicked, if any).
 * - Dismisses dialogs, closes popups and cancels downloads so they never block the run.
 * - While a click is being observed (`start()` → `stop()`), records its side effects.
 */
export class PageObserver {
  readonly consoleIssues: ConsoleIssue[] = [];
  private active: ClickObservation | null = null;

  constructor(context: BrowserContext, page: Page) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') this.addIssue('console-error', msg.text());
    });
    page.on('pageerror', (err) => {
      this.addIssue('page-error', err.message);
      this.active?.pageErrors.push(err.message);
    });
    page.on('dialog', (dialog) => {
      if (this.active) this.active.dialog = true;
      // "Leave site?" prompts must be accepted, or reloading the page would hang.
      const handle = dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      handle.catch(() => {});
    });
    page.on('download', (download) => {
      if (this.active) this.active.download = true;
      download.cancel().catch(() => {});
    });
    page.on('request', () => {
      if (this.active) this.active.requests++;
    });
    page.on('framenavigated', (frame) => {
      if (this.active && frame === page.mainFrame()) {
        this.active.navigation = { url: frame.url(), status: this.active.navigation?.status ?? null };
      }
    });
    page.on('response', (response) => {
      if (!this.active) return;
      try {
        if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
          this.active.navigation = { url: response.url(), status: response.status() };
        }
      } catch {
        // response.frame() throws for service-worker responses; ignore them
      }
    });
    context.on('page', (popup) => {
      if (this.active) this.active.popup = true;
      popup.close().catch(() => {});
    });
  }

  start(label: string): ClickObservation {
    this.active = {
      label,
      requests: 0,
      dialog: false,
      popup: false,
      download: false,
      navigation: null,
      pageErrors: [],
    };
    return this.active;
  }

  stop(): void {
    this.active = null;
  }

  private addIssue(type: ConsoleIssue['type'], message: string): void {
    const issue: ConsoleIssue = { type, message };
    if (this.active) issue.duringClickOf = this.active.label;
    this.consoleIssues.push(issue);
  }
}
