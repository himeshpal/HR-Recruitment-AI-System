"use client";

import "@xyflow/react/dist/style.css";

import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useMemo, useSyncExternalStore } from "react";
import { AlertCircle, Check, Code2, Loader2, Sparkles } from "lucide-react";

import { GRAPH_EDGES, GRAPH_NODES, type GraphNode } from "@/lib/agents";
import type { NodeActivity } from "@/lib/use-agent-events";
import { cn } from "@/lib/utils";

export type NodeState = "idle" | "running" | "done" | "error";

export function stateOf(activity: NodeActivity | undefined): NodeState {
  if (!activity) return "idle";
  if (activity.running > 0) return "running";
  if (activity.errored) return "error";
  return activity.calls > 0 ? "done" : "idle";
}

const STATE_TEXT: Record<NodeState, string> = { idle: "Idle", running: "Working", done: "Done", error: "Failed" };

type AgentNodeData = { node: GraphNode; activity: NodeActivity | undefined };

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { node, activity } = data;
  const state = stateOf(activity);
  const isCode = node.kind === "code";
  return (
    <div
      data-testid={`node-${node.id}`}
      data-state={state}
      title={node.help}
      className={cn(
        "relative w-[165px] rounded-xl border bg-card px-3 py-2.5 text-card-foreground shadow-sm transition-colors",
        isCode && "border-dashed",
        state === "running" && "border-primary ring-2 ring-primary/40",
        state === "done" && "border-emerald-500/60",
        state === "error" && "border-destructive ring-2 ring-destructive/30",
      )}
    >
      {activity?.lastAt != null && state !== "running" && (
        // A brief glow each time a call finishes.
        <motion.span
          key={activity.lastAt}
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 rounded-xl", state === "error" ? "bg-destructive/25" : "bg-emerald-500/25")}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 2.2 }}
        />
      )}
      <Handle id="l" type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-muted-foreground/50" />
      <Handle id="t" type="target" position={Position.Top} className="!size-1.5 !border-0 !bg-muted-foreground/50" />
      <div className="relative flex items-start gap-2">
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", isCode ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
          {isCode ? <Code2 className="size-3.5" /> : <Sparkles className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{node.label}</p>
          <p className="text-[11px] text-muted-foreground">{isCode ? "Runs in code" : node.stage}</p>
        </div>
      </div>
      <div className="relative mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-medium",
            state === "running" && "text-primary",
            state === "done" && "text-emerald-600 dark:text-emerald-400",
            state === "error" && "text-destructive",
            state === "idle" && "text-muted-foreground",
          )}
        >
          {state === "running" && <Loader2 className="size-3 animate-spin" />}
          {state === "done" && <Check className="size-3" />}
          {state === "error" && <AlertCircle className="size-3" />}
          {isCode ? "No AI" : STATE_TEXT[state]}
        </span>
        {!isCode && activity && activity.calls > 0 && (
          <span className="tabular-nums text-muted-foreground">
            {activity.calls} call{activity.calls === 1 ? "" : "s"}
            {activity.lastLatency !== null && (activity.lastCached ? " · cached" : ` · ${(activity.lastLatency / 1000).toFixed(1)}s`)}
          </span>
        )}
      </div>
      <Handle id="r" type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-muted-foreground/50" />
      <Handle id="b" type="source" position={Position.Bottom} className="!size-1.5 !border-0 !bg-muted-foreground/50" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

/** True on phone-sized screens, where the whole diagram cannot be read at once. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(max-width: 639px)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(max-width: 639px)").matches,
    () => false,
  );
}

/** True once the client has mounted. next-themes resolves the real theme from the OS/browser before the
 * first paint, but the server always renders as if it were light (it cannot know the browser's preference).
 * Unlike the rest of the app, React Flow's dark mode is a JS prop, not a `dark:` CSS class, so it cannot rely
 * on the usual suppressHydrationWarning trick; it must render "light" until mounted, then switch, so the
 * client's hydration pass matches the server. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function AgentGraph({ nodes: activity }: { nodes: Record<string, NodeActivity> }) {
  const { resolvedTheme } = useTheme();
  const narrow = useNarrow();
  const dark = useMounted() && resolvedTheme === "dark";

  const nodes = useMemo<Node<AgentNodeData>[]>(
    () =>
      GRAPH_NODES.map((node) => ({
        id: node.id,
        type: "agent",
        position: { x: node.x, y: node.y },
        data: { node, activity: activity[node.id] },
        draggable: false,
        selectable: false,
      })),
    [activity],
  );

  const edges = useMemo<Edge[]>(
    () =>
      GRAPH_EDGES.map(([from, to, direction]) => {
        const active = stateOf(activity[from]) === "running" || stateOf(activity[to]) === "running";
        return {
          id: `${from}-${to}`,
          source: from,
          target: to,
          sourceHandle: direction === "down" ? "b" : "r",
          targetHandle: direction === "down" ? "t" : "l",
          animated: active,
          style: { strokeWidth: active ? 2.5 : 1.25, stroke: active ? "var(--primary)" : undefined },
        };
      }),
    [activity],
  );

  return (
    <div className="h-[400px] w-full overflow-hidden rounded-xl border bg-muted/20 sm:h-[480px]" aria-label="Agent graph">
      <ReactFlow
        key={narrow ? "narrow" : "wide"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={dark ? "dark" : "light"}
        fitView={!narrow}
        fitViewOptions={{ padding: 0.04 }}
        // On a phone, start at a readable size on the busiest part (matcher and panel) and let people drag from there.
        defaultViewport={narrow ? { x: -190, y: 30, zoom: 0.8 } : undefined}
        minZoom={0.2}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
