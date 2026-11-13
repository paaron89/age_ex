import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

/** The model used for every AI call. */
export const AI_MODEL = 'claude-opus-5-5';

/**
 * Creates the Claude client. Credentials are resolved by the SDK
 * (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile).
 */
export function createClaudeClient(): Anthropic {
  return new Anthropic({ maxRetries: 1 });
}

/**
 * Cheap pre-flight check, so `--ai` can fail before the browser starts instead of after the run.
 * The SDK only reports missing credentials on the first request.
 */
export function hasClaudeCredentials(): boolean {
  const env = process.env;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE) return true;
  if (env.ANTHROPIC_FEDERATION_RULE_ID && (env.ANTHROPIC_IDENTITY_TOKEN || env.ANTHROPIC_IDENTITY_TOKEN_FILE)) return true;
  return existsSync(path.join(homedir(), '.config', 'anthropic')); // `ant auth login` profiles
}

/**
 * One structured-output request: Claude must answer with JSON matching `schema`.
 *
 * - Low effort keeps the call fast (thinking can't be turned off on this model; effort is the lever).
 * - `fallbacks: "default"`: if a safety classifier declines, Anthropic re-runs the request on its
 *   recommended fallback model instead of returning a refusal.
 * - Throws on timeout/abort, API errors, refusals, truncation or unparsable output.
 */
export async function askStructured<S extends z.ZodType>(
  client: Anthropic,
  params: { system: string; user: string; schema: S; signal: AbortSignal },
): Promise<z.infer<S>> {
  const response = await client.beta.messages.parse(
    {
      model: AI_MODEL,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(params.schema) },
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    },
    { signal: params.signal },
  );

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to answer (refusal).');
  if (response.stop_reason === 'max_tokens') throw new Error('Claude’s answer was cut off (max_tokens).');
  if (response.parsed_output == null) throw new Error('Claude’s answer did not match the expected format.');
  return response.parsed_output as z.infer<S>;
}

/** A readable one-line message for any error from a Claude call. */
export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Authentication failed: check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Permission denied for this API key or model.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API; try again later.';
  if (err instanceof Anthropic.APIUserAbortError) return 'Timed out (time budget reached).';
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'Timed out waiting for the Claude API.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API (network error).';
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ''}: ${firstLine(err.message)}`.trim();
  return err instanceof Error ? firstLine(err.message) : String(err);
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? s;
}
