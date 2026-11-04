# Vision: Web Page Smoke Test Agent

> Living document. Rough notes are fine here. Turn settled decisions into `CLAUDE.md` once they're stable.

## 1. Problem / User story

As a **QA tester**, I want an agent that **smoke tests a single web page**: it checks that its links and buttons work, so I get a quick health signal without writing tests by hand.

## 2. v1 Scope

- **Input:** one URL, passed on the command line.
  - e.g. `npx smoke-agent https://example.com/pricing`
- **What it checks** (initial idea, see §5 for open questions):
  - [ ] The page loads (HTTP status, no navigation error)
  - [ ] Links: every `<a href>` on the page resolves (no 4xx/5xx)
  - [ ] Buttons: visible, enabled, clickable, and clicking them doesn't cause a JS error or crash
  - [ ] Console errors / uncaught exceptions while loading and interacting
- **Time budget:** **1 minute max** for the whole run. When time runs out, stop and report whatever finished, marking the rest as "not checked".
- **Output:** a simple **HTML report** showing the URL, start time, total execution time, each check (target, result, duration, error), and summary counts.

### Non-goals for v1
No UI, no multiple URLs or crawling, no user journeys, no auth/login, no visual regression, no integration into other repos.

## 3. Work breakdown (phases)

Each phase gets its own feature branch and is merged before the next one starts.

| # | Phase | Branch | Deliverable | Done when |
|---|---|---|---|---|
| 1 | ✅ **Planning** | `planning` | This `docs/vision.md` | Open questions in §5 are answered and the stack is confirmed |
| 2 | ✅ **Project setup** | `project-setup` | TS/Node project, Playwright installed, CLI skeleton that accepts a URL and opens the page | `npx smoke-agent <url>` opens the page and prints its status |
| 3 | ✅ **Core check logic** | `core-checks` | Discover links and buttons, check them (including the risky-button denylist), collect results as structured JSON, enforce the 60s deadline | The run produces a results JSON within 60s on a sample page, and exit code 1 on failed checks |
| 4 | **HTML reporter** | tbd | Generate `report.html` from the results JSON; add `--out` | The report shows all checks, timings and the summary |
| 5 | **AI layer (`--ai`)** | tbd | Optional Claude-powered step on top of the deterministic results (see §4, "AI roadmap") | With `--ai`, warnings are triaged, risky buttons are classified by context, and the report has an AI summary; without `--ai`, nothing changes |
| 6 | **Hardening** | tbd | Self-tests against a local fixture page, edge cases (iframes, SPAs, slow pages), README polish | Runs reliably on 3–5 real pages |

Later phases come from the backlog in §6.

## 4. Tech approach

### Playwright: yes. "Playwright Agents": not for v1

| Option | What it is | Fit for v1 |
|---|---|---|
| **Playwright library** (deterministic script) | Code that finds links and buttons and checks them | ✅ **Recommended.** Fast, repeatable, free to run, easy to keep under 1 min |
| **Playwright Test Agents** (planner / generator / healer, LLM-driven) | An LLM explores the app and *writes or repairs* Playwright tests | ⚠️ Better for **later phases** (user journeys, generating tests for teams' repos). LLM round-trips are slow and nondeterministic, cost money per run, and make a 1-minute budget hard to hit |

**Direction:** keep a **deterministic core** and add an **optional LLM layer later** for things a script can't judge: whether a click did something meaningful, exploring journeys, and summarizing bugs.

### AI roadmap: from script to AI agent

The tool becomes an AI agent in two steps. AI is always **optional** (`--ai`): without it the tool stays fast, deterministic, free and CI-friendly, with no API key needed.

| Step | When | What the AI (Claude API) does | Agent level |
|---|---|---|---|
| **1. AI layer** | Phase 5 | **Triage:** reviews "no reaction" WARNINGs and decides which are real bugs. **Risky buttons:** classifies them by page context, alongside the keyword denylist. **Summary:** writes a plain-language summary of the findings and likely causes in the report. | AI-assisted: the AI judges the results, and the script still decides what to click |
| **2. Autonomous exploration** | Backlog | Looks at the page and decides the next action in a loop: follows user journeys and explores beyond a single page | Full AI agent: the AI decides what to do |

Constraints for step 1: a few batched LLM calls per run (not one per element), so the run stays within the 1-minute budget.

### Stack (confirmed)
- **TypeScript / Node.** Playwright's first-class language, and it's easy to publish as an npm package later.
- **`playwright`, Chromium only for v1.** Other browsers (Firefox, WebKit) come later, offered as an option such as `--browser`.
- **Report:** a self-contained HTML file generated from the JSON results
- **CLI:** `commander`. In v1 the command line is the only entry point.

### Architecture principle: core ≠ CLI
A UI and test-framework integration are planned for later, so the check logic must **not** live inside the CLI:

```
src/
  core/      ← runSmokeCheck(url, options) → results object (no CLI, no console output, no process.exit)
  reporter/  ← results → HTML (Phase 4)
  cli/       ← thin commander wrapper: parse args → core → reporter → exit code
```

That way a future UI, or a team's Playwright suite (`smokeCheck(page)`), can call `core` directly without going through the command line.

### Rough flow
1. Launch the browser and open the URL (record status and console errors)
2. Discover links and buttons on the page
3. **Links:** check them with parallel HTTP requests (fast; no navigating away)
4. **Buttons:** click each one in isolation (fresh page or reload between clicks), watching for errors, dialogs and navigation
5. Enforce the global 60s deadline (per-check timeouts plus an overall abort)
6. Write the results (Phase 3), then the HTML report (Phase 4)

## 5. Open questions (answered in Phase 1)

- [x] **What does "a button works" mean?**
  → **PASS** = the click raises no JS error **and** something happens (navigation, DOM change, network request or dialog). If there's no error but nothing happens, it's a **WARNING**. A JS error or crash is a **FAIL**.
- [x] **Risky buttons** ("Delete", "Logout", "Buy", "Pay", "Submit", "Unsubscribe", …):
  → **Skip them via a keyword denylist, but log every skipped button.** Each one goes into the run log and the report as **SKIPPED (risky)**, with its text or label, selector and the matched keyword, so the tester can check them by hand.
- [x] **External links:**
  → **Check all links.** A broken same-origin link is a **FAIL**; a failing or blocked external link (bot protection, timeout) is a **WARNING**.
- [x] **Hidden elements:**
  → **Visible only.** Hidden links are still checked over HTTP (no click needed). Hidden buttons are listed as **SKIPPED (not visible)**. Revealing menus and modals is backlog.
- [x] **Duplicate links:**
  → **Check each unique URL once,** and show in the report how many times it appears on the page.
- [x] **Exit code:**
  → `0` = no fails (warnings OK), `1` = at least one check failed, `2` = the tool crashed or the page didn't load.
- [x] **Headless?**
  → **Headless by default,** with `--headed` to watch the browser.
- [x] **Report location:**
  → `./reports/<host>-<timestamp>.html` (a new file per run; `reports/` is git-ignored). `--out <path>` overrides it.
- [x] **Test target:**
  → **The URL passed on the command line.** There's no fixed target page; we develop and verify against whatever URL is given. (Idea for Phase 6: add a small local fixture page with known-broken links and buttons for automated self-tests.)

## 6. Backlog (later phases)

- **UI:** a web form where you enter a URL and view the report
- **Multiple URLs and user journeys:** a URL list or sitemap, shallow crawling, scripted or LLM-explored flows (a good fit for Playwright Test Agents)
- **Autonomous AI exploration** (AI roadmap step 2): Claude drives the browser step by step and decides what to try next
- **Framework integration:** an npm package or Playwright fixture (`smokeCheck(page)`) that teams use in their own suites and CI
- **Richer report:** screenshots or video of failures, trends across runs, filtering, JUnit export
- **Config file** (`smoke.config.json`) for denylists, timeouts and selectors
- **Other browsers:** Firefox and WebKit via a `--browser` option

## 7. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-03 | Start with a deterministic Playwright core; defer LLM agents | Speed, cost and repeatability within the 1-min budget |
| 2026-11-03 | Split the work into phases, one feature branch each | Keeps changes small and reviewable |
| 2026-11-03 | Button PASS = no error + reaction; no reaction = WARNING | Catches dead buttons without failing harmless ones such as toggles or tooltips |
| 2026-11-03 | Skip risky buttons via a denylist, logging each skipped one | Avoids side effects on real sites while keeping full visibility |
| 2026-11-03 | Check all links; external failures are warnings | Third-party sites often block bots, so their failures shouldn't fail the run |
| 2026-11-03 | Visible elements only; check duplicate URLs once | Keeps the run within the 1-min budget |
| 2026-11-03 | Exit codes 0/1/2, headless by default, reports in `./reports/` | Ready for CI later |
| 2026-11-03 | Develop against the URL passed on the CLI | No fixed target page; the user supplies it |
| 2026-11-03 | Stack: TypeScript/Node, Playwright, Chromium, `commander` | Confirmed; other browsers come later as an option |
| 2026-11-03 | Keep the core logic separate from the CLI | Lets a future UI and test-framework integration reuse the core |
| 2026-11-03 | A 4xx/5xx main document counts as "page didn't load" (exit 2); usage errors also exit 2 | Exit 1 stays reserved for failed link/button checks |
| 2026-11-03 | `--out` deferred to Phase 4 | No report to write before Phase 4 |
| 2026-11-04 | Add Phase 5, an optional AI layer (`--ai`), with autonomous exploration in the backlog | Makes the tool an AI agent while keeping a deterministic, free, CI-friendly default |
| 2026-11-04 | Links returning HTTP 401/403 are WARNINGs, not FAILs | The target exists but needs a login or blocks bots; found 3 false failures on a real site |
| 2026-11-04 | Link requests use a separate request context (no shared cookies), HEAD first with GET fallback | A GET to e.g. a logout link can't end the browser session; many servers reject HEAD |
| 2026-11-04 | Buttons are clicked one at a time; the page is reloaded after any click that navigated or changed the DOM | Every button is tested from the same starting state |
| 2026-11-04 | A click is a FAIL on an uncaught JS error, when the button can't be clicked, or when it navigates to a 4xx/5xx page | Extends "no JS error" with the two most common real breakages |
| 2026-11-04 | Phase 3 writes the results JSON to `reports/<host>-<timestamp>.json` | The HTML report (Phase 4) is built from this file |
