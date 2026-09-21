"use client";

import { useSyncExternalStore } from "react";

// Blind mode hides names and contact details in the UI so recruiters are not swayed by them either.
// It is a tiny external store: shared by every component, kept in localStorage, and safe if
// storage is unavailable (private windows, blocked cookies).
const KEY = "blind-mode";
const listeners = new Set<() => void>();
let blind = true; // on by default: fair screening is the safe choice
let loaded = false;

function read(): boolean {
  if (!loaded) {
    loaded = true;
    try {
      blind = window.localStorage.getItem(KEY) !== "off";
    } catch {
      // storage blocked: keep the in-memory default
    }
  }
  return blind;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBlind(value: boolean) {
  blind = value;
  loaded = true;
  try {
    window.localStorage.setItem(KEY, value ? "on" : "off");
  } catch {
    // ignore: the choice still applies for this session
  }
  listeners.forEach((listener) => listener());
}

/** true while identities should be hidden. The server always renders the safe (blind) version. */
export function useBlind(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function displayName(candidate: { id: number; name: string }, isBlind: boolean): string {
  return isBlind ? `Candidate #${candidate.id}` : candidate.name;
}
