import { buildBudgetedResumeContext } from "@/lib/rag/budget";
import { truncateToTokenBudget } from "@/lib/rag/tokenizer";

// Converts this app's existing, already-tuned char-based budget constants (sized
// against Groq's real per-model TPM ceilings — see groq-client.ts) into token
// budgets. The conversion factor is an estimate; what happens *after* conversion is
// not — buildBudgetedResumeContext/truncateToTokenBudget measure real tokens against
// whatever budget this yields, rather than trusting a chars/N guess all the way
// through like the old truncateForBudget(text, maxChars) did.
const CHARS_PER_TOKEN_ESTIMATE = 3.3;

function tokenBudgetFromChars(maxChars: number): number {
  return Math.max(1, Math.ceil(maxChars / CHARS_PER_TOKEN_ESTIMATE));
}

/**
 * Resume text is section-shaped (Experience, Projects, Skills, ...), so this routes
 * through the priority-aware budget manager: under pressure it drops whole
 * low-value sections (Awards, Publications) before it touches Experience/Projects/
 * Skills, instead of chopping off whatever text happened to be physically last in
 * the document — see src/lib/rag/budget.ts for the full reasoning.
 */
export function budgetResumeText(text: string, maxChars: number): string {
  return buildBudgetedResumeContext(text, tokenBudgetFromChars(maxChars)).text;
}

/**
 * Free-form text (job descriptions, cover-letter fields, LinkedIn fields, extra
 * projects) has no resume section structure to prioritize, so real tokenizer-aware
 * truncation — measured tokens, cut on a token boundary — is the right amount of
 * sophistication here without inventing structure that isn't there.
 */
export function budgetPlainText(text: string, maxChars: number): string {
  return truncateToTokenBudget(text, tokenBudgetFromChars(maxChars)).text;
}
