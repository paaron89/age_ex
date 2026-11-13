# smoke-agent

A command-line tool that smoke-tests a single web page with Playwright. It checks that the page loads and that its links and buttons work, then writes a simple HTML report. The whole run is capped at **1 minute**.

> **Status: Phase 5 (AI mode).** The tool checks the page's links and buttons and writes an HTML report plus a JSON file. With `--ai`, Claude also reviews risky buttons, triages warnings and writes a summary. See [docs/vision.md](docs/vision.md) for the full plan.

## What it checks

| Check | PASS | WARNING | FAIL |
|---|---|---|---|
| **Page load** | 2xx/3xx | n/a | Any problem is a tool error (exit code `2`) |
| **Links** (`<a href>`, duplicates checked once, HEAD with GET fallback) | HTTP < 400 | External link broken or unreachable; HTTP 401/403 (login required); same-page `#anchor` target missing | Same-site link returns HTTP ≥ 400 or is unreachable |
| **Buttons** (`<button>`, `input[type=button/submit/reset/image]`, `[role=button]`) | Clicked, no JS error, and something happened (navigation, DOM change, network request, dialog, popup, download) | Clicked, no error, but nothing happened | Uncaught JS error, not clickable, or navigated to a 4xx/5xx page |

**Skipped:** buttons whose label matches a risky keyword (`delete`, `logout`, `buy`, `pay`, `submit`, `unsubscribe`, … see [src/core/risky.ts](src/core/risky.ts)) are **never clicked**; each one is listed so you can check it by hand. Hidden and disabled buttons, and non-http links (`mailto:`, `tel:`, …), are also skipped.

**Time limit:** the whole run is capped at 60 seconds. Anything not finished in time is reported as **not checked**.

## Requirements

- Node.js 20 or newer

## Setup

```bash
npm install                      # also builds dist/ via the "prepare" script
npx playwright install chromium  # one-time browser download
```

## Usage

```bash
npx smoke-agent <url> [--headed] [--timeout <seconds>] [--out <path>] [--ai]
```

| Argument / option | Description |
|---|---|
| `<url>` | The page to test. `https://` is added if you leave out the scheme (`example.com` works). |
| `--headed` | Show the browser window instead of running headless. |
| `-t, --timeout <seconds>` | Maximum run time, 5–60 seconds (default 60). Checks still running when time is up are reported as **not checked**. |
| `-o, --out <path>` | Where to save the report. A **folder** (e.g. `E:\reports`) gets the default file name `<host>-<timestamp>.html`; a path ending in **`.html`** is used as the exact file name. Default: `reports/`. The JSON is always saved next to the HTML with the same name. Missing folders are created. |
| `--ai` | Add an AI review with Claude (see [AI mode](#ai-mode---ai) below). Needs an API key and `--timeout` of at least 20. |
| `-h, --help` | Show help. |

Example:

```
$ npx smoke-agent http://localhost:4321/

Smoke check: http://localhost:4321/
  Page        200 OK  (24 ms)  "Smoke fixture"
  Links       8 unique (11 on page): 4 pass, 2 warning, 1 fail, 1 skipped
  Buttons     13 found: 6 pass, 1 warning, 2 fail, 4 skipped
  Console     2 error(s) (0 during page load)
  Duration    8.5 s

Failures (3)
  - link    http://localhost:4321/broken  ("Broken internal")  HTTP 404
  - button  "Throws error"  button#throws  JavaScript error after click: undefinedFunctionCall is not defined
  - button  "Go to broken page"  button#nav404  Navigated to http://localhost:4321/broken, which returned HTTP 404.

Warnings (3)
  - link    https://does-not-exist.invalid/x [external]  ("Broken external")  getaddrinfo ENOTFOUND does-not-exist.invalid
  - link    http://localhost:4321/#missing-anchor  ("Anchor missing")  No element with id or name "missing-anchor" on the page.
  - button  "Does nothing"  button#dead  No visible reaction: no navigation, DOM change, network request or dialog.

Skipped risky buttons: not clicked, check manually (2)
  - "Delete account"  button#danger  (keyword "delete")
  - "Submit form"  input[type="submit"]  (keyword "submit")

Report:  reports\localhost-2026-11-04_13-45-32.html
JSON:    reports\localhost-2026-11-04_13-45-32.json

Result: FAIL (3 failed checks)
```

### The HTML report

Each run writes a self-contained HTML report (no internet connection needed to view it) that shows:
- the overall verdict, start time, duration and page load result
- summary cards for links, buttons and console errors
- full tables of every link and button check, failures first, with a status filter (All / Fail / Warning / Skipped / Pass)
- the risky buttons that weren't clicked, to check manually
- all console errors, and which click caused them

Everything from the tested page is escaped, and only http(s) URLs are clickable, so a hostile page can't run script inside the report. The JSON file next to it holds the same data for other tools.

## AI mode (`--ai`)

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."   # get a key at https://console.anthropic.com
npm run smoke -- example.com --ai
```

With `--ai`, Claude (`claude-opus-5-5`) adds three things on top of the normal checks:

1. **Risky-button review before clicking.** One call looks at every button with its page context (form, nearest heading, nav/header/dialog) and can mark extra buttons as risky, e.g. "Continue" inside a checkout form. Those are **not clicked** and are listed under "check manually". The AI can only **add** skips: buttons skipped by the keyword list are never unblocked; for those it only adds an opinion.
2. **Warning triage.** After the run, each warning gets a verdict (**likely bug** / **likely fine** / **unsure**) with a short reason, e.g. an external site blocking bots vs. a dead button.
3. **Summary and next steps** in plain language at the top of the report and in the console output.

**What to know:**
- **Advisory only.** AI output never changes a check's status or the exit code, so CI results stay deterministic. It can be wrong.
- **Time.** The whole run still fits in `--timeout` (at least 20 s with `--ai`): 20 s are kept free for the triage call, and the button review may take up to 20 s while link checks keep running. If an AI call fails or runs out of time, the report is still written without it.
- **Data sent to Anthropic.** The page URL and title, button labels and their context, link URLs and texts, check results and console error messages are sent to the Claude API. Don't use `--ai` on pages whose content must not leave your network.
- **Cost.** Two requests per run; typically a few cents, more on very large pages.
- **Credentials.** The SDK reads `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile). Without credentials, `--ai` stops right away with exit code `2`.
- **Prompt injection.** Page text is passed to Claude as untrusted data and the prompts tell it to ignore instructions inside it. A hostile page could still try to influence the review; because the AI can only add skips and never changes statuses, the worst case is less coverage or a misleading summary.

During development you can run the TypeScript source directly, without building:

```bash
npm run smoke -- example.com
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No failures (warnings are OK) |
| `1` | At least one check failed |
| `2` | Tool error: the page did not load (network error or 4xx/5xx), the URL was invalid, or the tool crashed |

## Using it as a library

The check logic lives in `src/core` and has no CLI dependencies, so other code (a future UI, or your own Playwright tests) can call it directly:

```ts
import { runSmokeCheck } from 'smoke-agent';

const result = await runSmokeCheck('https://example.com', {
  headed: false,
  timeoutMs: 30_000,                   // max 60 000
  riskyKeywords: ['delete', 'logout'], // replaces the default denylist
});
console.log(result.summary.total);     // { total, pass, warning, fail, skipped, 'not-checked' }
console.log(result.links, result.buttons);
```

## Project structure

```
src/
  core/
    runSmokeCheck.ts  orchestrates a run: load page → discover → check links and buttons in parallel
    links.ts          finds <a href>, merges duplicates, checks anchors and HTTP status
    buttons.ts        finds buttons, clicks each one and classifies the reaction
    observer.ts       watches page events (errors, dialogs, popups, navigation, requests)
    risky.ts          the risky-button keyword denylist
    deadline.ts       the global time budget
    types.ts          the result types (SmokeResult, LinkCheck, ButtonCheck, …)
  ai/
    claude.ts         Claude client, credentials check, structured-output request helper
    buttonReview.ts   pre-click risky-button review (plugs into core via SmokeOptions.buttonRiskReviewer)
    triage.ts         post-run warning triage + summary
  reporter/
    htmlReport.ts     renderHtmlReport(result) → self-contained HTML string
  cli/
    index.ts          commander wrapper: parse args → core → save HTML + JSON → exit code
    printSummary.ts   the console summary
docs/
  vision.md   scope, decisions and roadmap
```

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |
| `npm run smoke -- <url>` | Run the CLI from source (via `tsx`) |
