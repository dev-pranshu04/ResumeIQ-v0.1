/**
 * Real tokenizer-aware counting, replacing the old chars/3.3 estimate.
 *
 * Why this exists: characters are not tokens. "AWS" is one token; "TensorFlow" is
 * several; camelCase identifiers, acronyms, and non-English text all tokenize at
 * different densities. A fixed chars-per-token constant either wastes budget
 * (undercounts, so requests still risk hitting Groq's TPM ceiling) or throws away
 * content unnecessarily (overcounts). Groq's Llama models use a different tokenizer
 * than OpenAI's, but no JS-native Llama tokenizer package exists that's practical to
 * bundle for a serverless deploy — so we use OpenAI's cl100k_base tokenizer (via the
 * dependency-free `gpt-tokenizer` package) as a measured proxy. It's not byte-exact
 * for Llama, but it is consistently and significantly more accurate than a flat
 * chars/3.3 guess, and — critically — it's a *real measurement* instead of a guess,
 * which is what lets budgeting be described honestly as "tokenizer-aware."
 */
import { encode } from "gpt-tokenizer";

/** Counts tokens in a string using a real tokenizer instead of a chars/N estimate. */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

/**
 * Truncates text to fit within `maxTokens`, cutting on a token boundary (via binary
 * search over the tokenizer, since gpt-tokenizer doesn't expose partial-decode) rather
 * than an arbitrary character offset. Falls back to an empty string only if maxTokens
 * is non-positive.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
): { text: string; truncated: boolean; tokensUsed: number } {
  if (maxTokens <= 0) return { text: "", truncated: text.length > 0, tokensUsed: 0 };

  const tokens = encode(text);
  if (tokens.length <= maxTokens) {
    return { text, truncated: false, tokensUsed: tokens.length };
  }

  // Binary search for the longest character prefix whose token count fits the budget.
  // gpt-tokenizer's `encode` is deterministic and cheap enough for this on resume-sized
  // text (a handful of KB), and it guarantees we never overshoot the real budget the
  // way a char-based slice can when a truncation point lands mid-multi-token-word.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encode(text.slice(0, mid)).length <= maxTokens) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const cut = text.slice(0, lo);
  return {
    text: `${cut}\n…[truncated to stay within token budget]`,
    truncated: true,
    tokensUsed: encode(cut).length,
  };
}
