"use client";

import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect } from "react";

import { cn } from "@/lib/utils";

export function scoreBand(score: number): { label: string; stroke: string; text: string } {
  if (score >= 75) return { label: "Strong fit", stroke: "stroke-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 50) return { label: "Partial fit", stroke: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400" };
  return { label: "Weak fit", stroke: "stroke-rose-500", text: "text-rose-600 dark:text-rose-400" };
}

/** A circular gauge that fills and counts up to the score. The number and label carry the meaning, not only colour. */
export function ScoreRing({ score, size = 64, className }: { score: number; size?: number; className?: string }) {
  const band = scoreBand(score);
  const stroke = Math.max(5, size / 11);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const value = useMotionValue(0);
  const dashOffset = useTransform(value, (v) => circumference * (1 - v / 100));
  const rounded = useTransform(value, (v) => Math.round(v).toString());

  useEffect(() => {
    const controls = animate(value, score, { duration: 0.9, ease: "easeOut" });
    return () => controls.stop();
  }, [score, value]);

  return (
    <div
      role="img"
      aria-label={`Match score ${Math.round(score)} out of 100: ${band.label}`}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
          className={band.stroke}
        />
      </svg>
      <motion.span
        className={cn("absolute inset-0 flex items-center justify-center font-semibold tabular-nums", band.text)}
        style={{ fontSize: size * 0.32 }}
      >
        {rounded}
      </motion.span>
    </div>
  );
}
