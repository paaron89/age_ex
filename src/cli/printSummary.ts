import type { ButtonCheck, LinkCheck, SmokeResult, StatusCounts } from '../core/index.js';

/** Max lines printed per list; the full details are in the results JSON. */
const MAX_LINES = 15;

/** Prints a human-readable summary of a smoke run to stdout. */
export function printSummary(r: SmokeResult, resultsPath: string | null): void {
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
  const risky = r.buttons.filter((b) => b.skipReason === 'risky');
  if (risky.length > 0) {
    out.push(`\nSkipped risky buttons: not clicked, check manually (${risky.length})`);
    for (const b of risky) out.push(`  - "${b.label}"  ${b.selector}  (keyword "${b.matchedKeyword}")`);
  }

  section(out, 'Not checked: time budget ran out', items.filter((i) => i.status === 'not-checked'));

  if (resultsPath) out.push(`\nResults saved to ${resultsPath}`);
  out.push(`\nResult: ${verdict(r)}\n`);
  console.log(out.join('\n'));
}

interface Item {
  status: string;
  line: string;
}

function asItem(c: LinkCheck | ButtonCheck): Item {
  if ('kind' in c) {
    const text = c.texts.length ? `  ("${c.texts[0]}"${c.occurrences > 1 ? `, ${c.occurrences}x` : ''})` : '';
    const where = c.external ? ' [external]' : '';
    return { status: c.status, line: `link    ${c.url}${where}${text}${c.message ? `  ${c.message}` : ''}` };
  }
  return { status: c.status, line: `button  "${c.label}"  ${c.selector}${c.message ? `  ${c.message}` : ''}` };
}

function section(out: string[], title: string, items: Item[]): void {
  if (items.length === 0) return;
  out.push(`\n${title} (${items.length})`);
  for (const i of items.slice(0, MAX_LINES)) out.push(`  - ${i.line}`);
  if (items.length > MAX_LINES) out.push(`  … and ${items.length - MAX_LINES} more (see the results JSON)`);
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
