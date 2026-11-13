import type { ButtonCheck, LinkCheck, SmokeResult, StatusCounts } from '../core/index.js';

/** Where the CLI saved the report files. */
export interface SavedFiles {
  html: string;
  json: string;
}

/** Max lines printed per list; the full details are in the results JSON. */
const MAX_LINES = 15;

/** Prints a human-readable summary of a smoke run to stdout. */
export function printSummary(r: SmokeResult, saved: SavedFiles | null): void {
  const out: string[] = [`\nSmoke check: ${r.url}`];
  const { page } = r;

  if (page.ok) {
    out.push(`  Page        ${page.status} OK  (${page.loadTimeMs} ms)  "${page.title ?? ''}"`);
  } else if (page.status !== null) {
    out.push(`  Page        ${page.status} FAILED  (${page.loadTimeMs} ms)`);
  } else {
    out.push(`  Page        FAILED to load: ${page.error ?? 'unknown error'}`);
  }
  if (page.finalUrl && page.finalUrl !== r.url) out.push(`  Redirected  ${page.finalUrl}`);

  if (page.ok) {
    const onPage = r.links.reduce((n, l) => n + l.occurrences, 0);
    out.push(`  Links       ${r.links.length} unique (${onPage} on page): ${counts(r.summary.links)}`);
    out.push(`  Buttons     ${r.buttons.length} found: ${counts(r.summary.buttons)}`);
  }
  const duringLoad = r.consoleIssues.filter((i) => !i.duringClickOf).length;
  out.push(`  Console     ${r.consoleIssues.length} error(s) (${duringLoad} during page load)`);
  out.push(`  Duration    ${(r.durationMs / 1000).toFixed(1)} s${r.timedOut ? '  (time budget ran out, some checks not done)' : ''}`);

  const items = [...r.links.map(asItem), ...r.buttons.map(asItem)];
  section(out, 'Failures', items.filter((i) => i.status === 'fail'));
  section(out, 'Warnings', items.filter((i) => i.status === 'warning'));

  // Every risky button is listed (no limit): the tester should check these by hand.
  const risky = r.buttons.filter((b) => b.skipReason === 'risky' || b.skipReason === 'ai-risky');
  if (risky.length > 0) {
    out.push(`\nSkipped risky buttons: not clicked, check manually (${risky.length})`);
    for (const b of risky) {
      const why = b.skipReason === 'risky' ? `keyword "${b.matchedKeyword}"` : 'AI review';
      const opinion = b.ai ? `  [AI: ${b.ai.verdict}] ${b.ai.reason}` : '';
      out.push(`  - "${b.label}"  ${b.selector}  (${why})${b.skipReason === 'risky' ? opinion : `  ${b.ai?.reason ?? ''}`}`);
    }
  }

  section(out, 'Not checked: time budget ran out', items.filter((i) => i.status === 'not-checked'));
  if (r.ai) aiSection(out, r);

  if (saved) out.push(`\nReport:  ${saved.html}\nJSON:    ${saved.json}`);
  out.push(`\nResult: ${verdict(r)}\n`);
  console.log(out.join('\n'));
}

interface Item {
  status: string;
  line: string;
}

function asItem(c: LinkCheck | ButtonCheck): Item {
  // AI triage notes are shown on warnings only (skips have their own section).
  const ai = c.ai && c.status === 'warning' ? `\n      [AI: ${c.ai.verdict}] ${c.ai.reason}` : '';
  if ('kind' in c) {
    const text = c.texts.length ? `  ("${c.texts[0]}"${c.occurrences > 1 ? `, ${c.occurrences}x` : ''})` : '';
    const where = c.external ? ' [external]' : '';
    return { status: c.status, line: `link    ${c.url}${where}${text}${c.message ? `  ${c.message}` : ''}${ai}` };
  }
  return { status: c.status, line: `button  "${c.label}"  ${c.selector}${c.message ? `  ${c.message}` : ''}${ai}` };
}

function aiSection(out: string[], r: SmokeResult): void {
  const ai = r.ai!;
  out.push(`\nAI review${ai.model ? ` (${ai.model})` : ''}: advisory, may be wrong`);
  if (ai.buttonReview) {
    const br = ai.buttonReview;
    out.push(
      br.ok
        ? `  Buttons reviewed before clicking: ${br.reviewed}, extra skipped as risky: ${br.addedSkips}  (${(br.durationMs / 1000).toFixed(1)} s)`
        : `  Button review failed: ${br.error}`,
    );
  }
  if (ai.triage && !ai.triage.ok) out.push(`  Triage and summary failed: ${ai.triage.error}`);
  if (ai.summary) out.push('', ...wrap(ai.summary, 96).map((l) => `  ${l}`));
  if (ai.recommendations?.length) {
    out.push('', '  Next steps:');
    for (const rec of ai.recommendations) out.push(`  - ${rec}`);
  }
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function section(out: string[], title: string, items: Item[]): void {
  if (items.length === 0) return;
  out.push(`\n${title} (${items.length})`);
  for (const i of items.slice(0, MAX_LINES)) out.push(`  - ${i.line}`);
  if (items.length > MAX_LINES) out.push(`  … and ${items.length - MAX_LINES} more (see the HTML report)`);
}

function counts(c: StatusCounts): string {
  const parts = [`${c.pass} pass`, `${c.warning} warning`, `${c.fail} fail`, `${c.skipped} skipped`];
  if (c['not-checked'] > 0) parts.push(`${c['not-checked']} not checked`);
  return parts.join(', ');
}

function verdict(r: SmokeResult): string {
  if (!r.page.ok) return 'ERROR (page did not load)';
  const { fail, warning } = r.summary.total;
  if (fail > 0) return `FAIL (${fail} failed check${fail === 1 ? '' : 's'})`;
  if (warning > 0) return `PASS with ${warning} warning${warning === 1 ? '' : 's'}`;
  return 'PASS';
}
