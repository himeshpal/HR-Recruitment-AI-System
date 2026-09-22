"use client";

import { useEffect, useReducer } from "react";

import { API_URL, apiFetch } from "@/lib/api";
import { nodeFor, type AgentEvent } from "@/lib/agents";

export type NodeActivity = {
  running: number; // calls in flight right now
  calls: number; // calls finished since the page opened
  lastAt: number | null; // when the last one finished (ms), for the "just finished" glow
  lastLatency: number | null;
  lastCached: boolean;
  errored: boolean; // the last call failed
};

export type FeedItem = Extract<AgentEvent, { type: "finish" | "error" }> & { key: string };

type State = {
  connected: boolean;
  lastSeq: number;
  inFlight: Record<string, string>; // call_id -> node id
  nodes: Record<string, NodeActivity>;
  feed: FeedItem[]; // newest first
};

const FEED_LIMIT = 60;
const EMPTY: NodeActivity = { running: 0, calls: 0, lastAt: null, lastLatency: null, lastCached: false, errored: false };

type Action = { type: "connected"; value: boolean } | { type: "events"; events: AgentEvent[]; replay: boolean };

function apply(state: State, event: AgentEvent, replay: boolean): State {
  if (event.seq <= state.lastSeq) return state; // already seen (a reconnect replays the tail)
  const node = nodeFor(event.agent);
  const nodes = { ...state.nodes };
  const inFlight = { ...state.inFlight };
  let feed = state.feed;
  const current = node ? (nodes[node] ?? EMPTY) : EMPTY;

  if (event.type === "start") {
    if (node && !replay) {
      inFlight[event.call_id] = node;
      nodes[node] = { ...current, running: current.running + 1, errored: false };
    }
  } else {
    const owner = event.call_id ? inFlight[event.call_id] : undefined;
    if (owner) delete inFlight[event.call_id as string];
    if (node && !replay) {
      // History (replay) only fills the feed: the graph shows what happens while this page is open.
      nodes[node] = {
        running: owner ? Math.max(0, current.running - 1) : current.running,
        calls: current.calls + (event.type === "finish" ? 1 : 0),
        lastAt: Date.now(),
        lastLatency: event.type === "finish" ? event.latency_ms : current.lastLatency,
        lastCached: event.type === "finish" ? event.cached : current.lastCached,
        errored: event.type === "error",
      };
    }
    feed = [{ ...event, key: `${event.seq}` }, ...feed].slice(0, FEED_LIMIT);
  }
  return { ...state, lastSeq: event.seq, inFlight, nodes, feed };
}

function reducer(state: State, action: Action): State {
  if (action.type === "connected") return { ...state, connected: action.value };
  return action.events.reduce((s, e) => apply(s, e, action.replay), state);
}

/**
 * Live agent activity. It first loads what already happened (so the feed is not empty on arrival, and calls that
 * finished before this page opened do not light up), then follows the server-sent event stream.
 * Calls that were already running when the page opened are not shown as running: only events seen live count.
 */
export function useAgentEvents() {
  const [state, dispatch] = useReducer(reducer, { connected: false, lastSeq: 0, inFlight: {}, nodes: {}, feed: [] });

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;
    apiFetch<AgentEvent[]>("/api/agents/recent")
      .then((events) => {
        if (cancelled) return;
        dispatch({ type: "events", events, replay: true });
        const after = events.length ? events[events.length - 1].seq : 0;
        source = new EventSource(`${API_URL}/api/agents/stream?after=${after}`);
        source.onopen = () => dispatch({ type: "connected", value: true });
        source.onerror = () => dispatch({ type: "connected", value: false }); // EventSource retries by itself
        source.onmessage = (message) => dispatch({ type: "events", events: [JSON.parse(message.data) as AgentEvent], replay: false });
      })
      .catch(() => dispatch({ type: "connected", value: false }));
    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  return state;
}
