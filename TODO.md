# TODO

Ideas for later. Not scheduled yet; pick them up in a future phase (see [docs/vision.md](docs/vision.md)).

## Report output folder (best practices)

Today every run adds a new timestamped file to `reports/`, so the folder only grows. Ideas, following how tools like Playwright and Allure handle reports:

- [ ] **`latest.html` / `latest.json`:** always overwritten with the most recent run, so there's one stable path to open or upload as a CI artifact.
- [ ] **`history/` subfolder:** timestamped copies of past runs (`<host>-<timestamp>.html/.json`).
- [ ] **Retention:** keep only the last N runs in `history/` (e.g. `--keep <n>`, default 20; `0` = no history). Only delete files that match the tool's own naming pattern.
- [ ] **Clean command:** `npm run reports:clean` to wipe the default `reports/` folder.
- [ ] **Same layout for `--out <folder>`;** a path ending in `.html` stays an exact file with no history.
- [ ] **CI docs:** how to upload `reports/` as a build artifact.

## Report content

- [ ] **`<a href="javascript:…">` as buttons:** found on windguru.cz, where 25 such links were skipped and 0 buttons found. Click and judge them like buttons, with the same risky-keyword protection.
- [ ] **Clickable elements without button semantics:** e.g. `div`/`span` with an `onclick` handler or `cursor: pointer`.
- [ ] **Screenshots of failures** embedded in the report.
- [ ] **History index page** (`reports/index.html`) listing past runs with their verdicts and trends.
- [ ] **`--open` flag** to open the report in the browser after the run.
- [ ] **Group repeated skipped links** (e.g. `javascript:void(0)` ×18) more compactly.
- [ ] **"Copy as Markdown" summary** for pasting into bug tickets.
- [ ] **JUnit XML output** for CI test dashboards.
- [ ] **Library export:** expose `renderHtmlReport` in `package.json` `exports`, so library users can generate the report too.
