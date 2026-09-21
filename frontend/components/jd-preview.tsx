"use client";

import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { LanguageFlag } from "@/lib/types";
import { highlightRegex } from "@/lib/language";

// Minimal shape of the hast nodes react-markdown hands to rehype plugins.
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const MARK_CLASSES = [
  "rounded-sm",
  "bg-amber-200/70",
  "px-0.5",
  "text-inherit",
  "underline",
  "decoration-amber-500",
  "decoration-wavy",
  "underline-offset-2",
  "dark:bg-amber-400/25",
];

/** rehype plugin: wrap every flagged phrase in a <mark> that explains itself on hover. */
function rehypeMarks({ regex, reasons }: { regex: RegExp; reasons: Map<string, string> }) {
  const visit = (node: HastNode) => {
    if (!node.children || node.tagName === "code" || node.tagName === "pre") return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== "text" || !child.value) {
        visit(child);
        return [child];
      }
      // With one capture group, split() puts the matched phrases at the odd indices.
      return child.value.split(regex).flatMap((part, i): HastNode[] => {
        if (part === "") return [];
        if (i % 2 === 0) return [{ type: "text", value: part }];
        return [
          {
            type: "element",
            tagName: "mark",
            properties: { className: MARK_CLASSES, title: reasons.get(part.toLowerCase()) ?? "Flagged wording" },
            children: [{ type: "text", value: part }],
          },
        ];
      });
    });
  };
  return (tree: HastNode) => visit(tree);
}

export function JdPreview({
  markdown,
  flags,
  streaming,
}: {
  markdown: string;
  flags: LanguageFlag[];
  streaming: boolean;
}) {
  const plugins = useMemo(() => {
    const regex = highlightRegex(flags);
    if (!regex) return [];
    const reasons = new Map(flags.map((f) => [f.phrase.toLowerCase(), f.reason]));
    return [[rehypeMarks, { regex, reasons }]] as never;
  }, [flags]);

  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:tracking-tight prose-h1:text-2xl prose-h2:mt-6 prose-h2:text-lg">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={plugins}>
        {markdown}
      </ReactMarkdown>
      {streaming && (
        <span
          aria-hidden
          className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary align-middle"
        />
      )}
    </div>
  );
}
