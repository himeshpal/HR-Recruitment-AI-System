export type QuoteRange = { start: number; end: number; index: number };

const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Regex for a quote that tolerates the same differences the server ignores when it verifies quotes:
 * case, runs of whitespace, and typographic apostrophes, quotes and dashes.
 */
function quoteRegex(quote: string): RegExp {
  let pattern = "";
  let lastWasSpace = false;
  for (const char of quote.trim()) {
    if (/\s/.test(char)) {
      if (!lastWasSpace) pattern += "\\s+";
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    if (/['‘’]/.test(char)) pattern += "['‘’]";
    else if (/["“”]/.test(char)) pattern += '["“”]';
    else if (/[-–—−]/.test(char)) pattern += "[-–—−]";
    else pattern += escape(char);
  }
  return new RegExp(pattern, "i");
}

/** Where each quote sits in `text` (first match; quotes that overlap an earlier one or are absent are skipped). */
export function findQuoteRanges(text: string, quotes: string[]): QuoteRange[] {
  const ranges: QuoteRange[] = [];
  quotes.forEach((quote, index) => {
    if (!quote.trim()) return;
    const match = quoteRegex(quote).exec(text);
    if (!match) return;
    const start = match.index;
    const end = start + match[0].length;
    if (ranges.some((r) => start < r.end && r.start < end)) return;
    ranges.push({ start, end, index });
  });
  return ranges.sort((a, b) => a.start - b.start);
}
