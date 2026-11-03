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
| 1 | **Planning** | `planning` | This `docs/vision.md` | Open questions in §5 are answered and the stack is confirmed |
| 2 | **Project setup** | tbd | TS/Node project, Playwright installed, CLI skeleton that accepts a URL and opens the page | `npx smoke-agent <url>` opens the page and prints its status |
| 3 | **Core check logic** | tbd | Discover links and buttons, check them, collect results as structured JSON, enforce the 60s deadline | The run produces a `results.json` within 60s on a sample page |
| 4 | **HTML reporter** | tbd | Generate `report.html` from the results JSON | The report shows all checks, timings and the summary |
| 5 | **Hardening** | tbd | Destructive-button safety, exit codes, `--headed` flag, tests for the agent itself, README usage | Runs reliably on 3–5 real pages |

Later phases come from the backlog in §6.

## 4. Tech approach

### Playwright: yes. "Playwright Agents": not for v1

| Option | What it is | Fit for v1 |
|---|---|---|
| **Playwright library** (deterministic script) | Code that finds links and buttons and checks them | ✅ **Recommended.** Fast, repeatable, free to run, easy to keep under 1 min |
| **Playwright Test Agents** (planner / generator / healer, LLM-driven) | An LLM explores the app and *writes or repairs* Playwright tests | ⚠️ Better for **later phases** (user journeys, generating tests for teams' repos). LLM round-trips are slow and nondeterministic, cost money per run, and make a 1-minute budget hard to hit |

**Direction:** keep a **deterministic core** and add an **optional LLM layer later** for things a script can't judge: whether a click did something meaningful, exploring journeys, and summarizing bugs.

### Stack (proposal, to confirm)
- **TypeScript / Node.** Playwright's first-class language, and it's easy to publish as an npm CLI later.
- **`playwright`,** Chromium only for v1
- **Report:** a self-contained HTML file generated from the JSON results
- **CLI:** `commander` or plain `process.argv`

### Rough flow
1. Launch the browser and open the URL (record status and console errors)
2. Discover links and buttons on the page
3. **Links:** check them with parallel HTTP requests (fast; no navigating away)
4. **Buttons:** click each one in isolation (fresh page or reload between clicks), watching for errors, dialogs and navigation
5. Enforce the global 60s deadline (per-check timeouts plus an overall abort)
6. Write the results (Phase 3), then the HTML report (Phase 4)

## 5. Open questions (answer in Phase 1)

- [ ] **What does "a button works" mean?** It's clickable, there's no JS error after the click, *and* something happens (navigation, DOM change, network request)? Is "nothing happened" a fail or a warning?
- [ ] **Destructive buttons** ("Delete", "Logout", "Buy", form submits): skip them using a keyword denylist?
- [ ] **External links:** check them, or only same-origin ones? Is a blocked third party a warning or a fail?
- [ ] **Hidden elements:** check only visible ones? What about elements inside menus or modals?
- [ ] **Duplicate links:** check each unique href only once?
- [ ] **Exit code:** non-zero when any check fails (for CI later)?
- [ ] **Headless by default,** with a `--headed` flag?
- [ ] **Report location:** `./reports/<host>-<timestamp>.html`?
- [ ] **Test target:** which real page(s) do we develop against?

## 6. Backlog (later phases)

- **UI:** a web form where you enter a URL and view the report
- **Multiple URLs and user journeys:** a URL list or sitemap, shallow crawling, scripted or LLM-explored flows (a good fit for Playwright Test Agents)
- **Framework integration:** an npm package or Playwright fixture (`smokeCheck(page)`) that teams use in their own suites and CI
- **Richer report:** screenshots or video of failures, trends across runs, filtering, JUnit export
- **Config file** (`smoke.config.json`) for denylists, timeouts and selectors

## 7. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-11-03 | Start with a deterministic Playwright core; defer LLM agents | Speed, cost and repeatability within the 1-min budget |
| 2026-11-03 | Split the work into phases, one feature branch each | Keeps changes small and reviewable |
