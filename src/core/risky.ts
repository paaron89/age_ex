/**
 * Buttons whose label contains one of these words or phrases are not clicked,
 * because clicking them on a real site could have side effects.
 */
export const DEFAULT_RISKY_KEYWORDS: readonly string[] = [
  'delete',
  'remove',
  'destroy',
  'erase',
  'logout',
  'log out',
  'sign out',
  'signout',
  'buy',
  'purchase',
  'pay',
  'checkout',
  'check out',
  'order',
  'submit',
  'send',
  'confirm',
  'unsubscribe',
  'deactivate',
  'close account',
  'cancel subscription',
  'transfer',
  'reset',
];

/** Returns the first keyword that matches `label` as a whole word or phrase, or undefined. */
export function matchRiskyKeyword(label: string, keywords: readonly string[]): string | undefined {
  const text = label.toLowerCase();
  return keywords.find((kw) => new RegExp(`\\b${escapeRegExp(kw.toLowerCase())}\\b`).test(text));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
