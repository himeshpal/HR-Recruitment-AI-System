import type { LanguageFlag } from "@/lib/types";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex matching every flagged phrase as a whole word (longest phrases first). */
export function highlightRegex(flags: LanguageFlag[]): RegExp | null {
  const phrases = [...new Set(flags.map((f) => f.phrase.toLowerCase()))].sort(
    (a, b) => b.length - a.length,
  );
  if (!phrases.length) return null;
  return new RegExp(`\\b(${phrases.map(escapeRegExp).join("|")})\\b`, "gi");
}

/** Replace every occurrence of `phrase` with `suggestion`, keeping a leading capital. */
export function applySuggestion(text: string, phrase: string, suggestion: string): string {
  const regex = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
  return text.replace(regex, (match) =>
    match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()
      ? suggestion[0].toUpperCase() + suggestion.slice(1)
      : suggestion,
  );
}
