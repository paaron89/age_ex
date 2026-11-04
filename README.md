# smoke-agent

A command-line tool that smoke-tests a single web page with Playwright. It checks that the page loads and that its links and buttons work, then writes a simple HTML report. The whole run is capped at **1 minute**.

> **Status: Phase 3 (core checks).** The tool checks the page's links and buttons and saves the results as JSON. The HTML report comes in Phase 4 and an optional AI mode (`--ai`) in Phase 5. See [docs/vision.md](docs/vision.md) for the full plan.

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
npx smoke-agent <url> [--headed] [--timeout <seconds>]
```

| Argument / option | Description |
|---|---|
| `<url>` | The page to test. `https://` is added if you leave out the scheme (`example.com` works). |
| `--headed` | Show the browser window instead of running headless. |
| `-t, --timeout <seconds>` | Maximum run time, 5–60 seconds (default 60). Checks still running when time is up are reported as **not checked**. |
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

Results saved to reports\localhost-2026-11-04_13-45-32.json

Result: FAIL (3 failed checks)
```

The full details of every check are saved to `reports/<host>-<timestamp>.json`.

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
  cli/
    index.ts          commander wrapper: parse args → core → save JSON → exit code
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
