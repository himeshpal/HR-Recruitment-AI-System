"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";

import { findQuoteRanges } from "@/lib/highlight";
import { cn } from "@/lib/utils";

const PLACEHOLDER = /(\[(?:CANDIDATE|EMAIL|PHONE|LOCATION|INSTITUTION)\])/;

/** Plain text with the placeholders the Bias Shield inserted shown as small chips. */
function WithPlaceholders({ text }: { text: string }) {
  return (
    <>
      {text.split(PLACEHOLDER).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-primary/10 px-1 font-medium text-primary" title="Hidden from the AI by the Bias Shield">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Resume text with the AI's evidence quotes highlighted and numbered to match the evidence list. */
export function ResumeViewer({
  text,
  quotes,
  activeIndex,
  className,
}: {
  text: string;
  quotes: string[];
  activeIndex: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const ranges = useMemo(() => findQuoteRanges(text, quotes), [text, quotes]);

  useEffect(() => {
    if (activeIndex === null) return;
    ref.current
      ?.querySelector(`[data-quote="${activeIndex}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, text]);

  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) pieces.push(<WithPlaceholders key={`t${cursor}`} text={text.slice(cursor, range.start)} />);
    const active = range.index === activeIndex;
    pieces.push(
      <mark
        key={`q${range.index}`}
        data-quote={range.index}
        className={cn(
          "rounded-sm px-0.5 text-inherit transition-colors",
          active ? "bg-amber-300 ring-2 ring-amber-500 dark:bg-amber-400/40" : "bg-amber-200/70 dark:bg-amber-400/25",
        )}
      >
        <WithPlaceholders text={text.slice(range.start, range.end)} />
        <sup className="ml-0.5 font-sans text-[10px] font-semibold text-amber-700 dark:text-amber-300">{range.index + 1}</sup>
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) pieces.push(<WithPlaceholders key={`t${cursor}`} text={text.slice(cursor)} />);

  return (
    <pre
      ref={ref}
      className={cn("overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed", className)}
    >
      {pieces}
    </pre>
  );
}
