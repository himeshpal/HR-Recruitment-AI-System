"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The Web Speech API is built into Chrome and Edge and is free. It is not in TypeScript's DOM types,
// so only the small part we use is described here. Everything degrades to plain typing when it is missing.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noSubscription = () => () => {};

/** Voice dictation into a text box. `supported` is false on the server and in browsers without the API. */
export function useDictation(text: string, setText: (text: string) => void) {
  const supported = useSyncExternalStore(noSubscription, () => Boolean(recognitionCtor()), () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const textRef = useRef(text); // the text as it was when dictation started

  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => () => recognition.current?.stop(), []);

  const stop = useCallback(() => recognition.current?.stop(), []);
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const base = textRef.current.trim();
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (event) => {
      let spoken = "";
      for (let i = 0; i < event.results.length; i++) spoken += event.results[i][0].transcript;
      setText([base, spoken.trim()].filter(Boolean).join(" "));
    };
    r.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Microphone access was blocked. Allow it in the browser to dictate." : `Voice input stopped (${event.error}).`);
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setError(null);
    setListening(true);
    r.start();
  }, [setText]);

  return { supported, listening, error, start, stop };
}

/** Read text aloud with the browser's built-in voice. */
export function useReadAloud() {
  const supported = useSyncExternalStore(noSubscription, () => typeof window !== "undefined" && "speechSynthesis" in window, () => false);
  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }, []);
  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  useEffect(() => cancel, [cancel]);
  return { supported, speak, cancel };
}
