# smoke-agent

A command-line tool that smoke-tests a single web page with Playwright. It checks that the page loads and that its links and buttons work, then writes a simple HTML report. The whole run is capped at **1 minute**.

> **Status: Phase 2 (project setup).** The tool currently loads the page and reports its HTTP status, load time and console errors. Link and button checks come in Phase 3 and the HTML report in Phase 4. See [docs/vision.md](docs/vision.md) for the full plan.

## Requirements

- Node.js 20 or newer

## Setup

```bash
npm install                      # also builds dist/ via the "prepare" script
npx playwright install chromium  # one-time browser download
```

## Usage

```bash
npx smoke-agent <url> [--headed]
```

| Argument / option | Description |
|---|---|
| `<url>` | The page to test. `https://` is added if you leave out the scheme (`example.com` works). |
| `--headed` | Show the browser window instead of running headless. |
| `-h, --help` | Show help. |

Example:

```
$ npx smoke-agent example.com

Smoke check: https://example.com/
  Page        200 OK  (95 ms)  "Example Domain"
  Console     0 error(s)
  Duration    0.3 s

Result: PASS (page loaded)
```

During development you can run the TypeScript source directly, without building:

```bash
npm run smoke -- example.com
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No failures (warnings are OK) |
| `1` | At least one check failed (from Phase 3) |
| `2` | Tool error: the page did not load (network error or 4xx/5xx), the URL was invalid, or the tool crashed |

## Using it as a library

The check logic lives in `src/core` and has no CLI dependencies, so other code (a future UI, or your own Playwright tests) can call it directly:

```ts
import { runSmokeCheck } from 'smoke-agent';

const result = await runSmokeCheck('https://example.com', { headed: false });
console.log(result.page.status, result.consoleIssues);
```

## Project structure

```
src/
  core/   runSmokeCheck(url, options) → result object (no console output, no process.exit)
  cli/    commander wrapper: parses args → calls core → prints a summary → sets the exit code
docs/
  vision.md   scope, decisions and roadmap
```

## Scripts

| Script | What it does |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |
| `npm run smoke -- <url>` | Run the CLI from source (via `tsx`) |
