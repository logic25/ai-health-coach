"use client";

/* Tiny client-side helpers: fetch wrapper, voice capture, image compression. */

import { useCallback, useEffect, useRef, useState } from "react";

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<T> {
  const { json: body, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status}`);
  return data as T;
}

export function useFetch<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    api<T>(path)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

/* Voice input: Web Speech API primary, /api/transcribe fallback. */
export function useVoice(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  const start = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const text = Array.from(e.results)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript)
        .join(" ");
      if (text.trim()) onText(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [onText]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  return { listening, supported, start, stop };
}

/* Hands-free wake-word listening (workout mode).
   Runs SpeechRecognition continuously, auto-restarting when the browser
   stops it. Say "<wakeWord>, log nine reps" in one breath, or say the wake
   word alone and speak the command in the next few seconds. Requests a
   screen wake lock while active so the mic stays alive during a workout. */
export function useWakeWord(wakeWord: string, onCommand: (text: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [armed, setArmed] = useState(false); // wake word heard, awaiting command
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockRef = useRef<any>(null);
  const armedUntil = useRef(0);
  const enabledRef = useRef(false);
  const onCommandRef = useRef(onCommand);
  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  const supported =
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      recRef.current?.stop?.();
      recRef.current = null;
      lockRef.current?.release?.().catch(() => {});
      lockRef.current = null;
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) return;

    navigator.wakeLock?.request("screen").then((l) => (lockRef.current = l)).catch(() => {});

    const wake = wakeWord.toLowerCase();
    const start = () => {
      const rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const text = (e.results[i][0].transcript as string).trim();
          const lower = text.toLowerCase();
          const idx = lower.indexOf(wake);
          if (idx >= 0) {
            const command = text.slice(idx + wake.length).replace(/^[\s,.:!-]+/, "").trim();
            if (command) {
              onCommandRef.current(command);
              setArmed(false);
            } else {
              armedUntil.current = Date.now() + 8000; // "Coach" alone → wait for command
              setArmed(true);
            }
          } else if (Date.now() < armedUntil.current && text) {
            armedUntil.current = 0;
            setArmed(false);
            onCommandRef.current(text);
          }
        }
      };
      rec.onend = () => {
        if (enabledRef.current) setTimeout(() => { try { start(); } catch { /* retry next end */ } }, 250);
      };
      rec.onerror = () => { /* onend fires next and restarts */ };
      recRef.current = rec;
      rec.start();
    };
    try { start(); } catch { /* mic permission denied */ }

    return () => {
      enabledRef.current = false;
      recRef.current?.stop?.();
      recRef.current = null;
      lockRef.current?.release?.().catch(() => {});
      lockRef.current = null;
    };
  }, [enabled, wakeWord]);

  return { enabled, setEnabled, armed: armed && enabled, supported };
}

/* Camera/photo input compressed to ~1000px JPEG base64. */
export function compressImage(file: File, maxDim = 1000): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      URL.revokeObjectURL(url);
      resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
    };
    img.onerror = reject;
    img.src = url;
  });
}
