"use client";

/* Global coach input: [ Type ] [ Voice ] [ Camera ].
   Used on Today, Eat, Coach and Workout screens with different submit targets. */

import { useRef, useState } from "react";
import { compressImage, useVoice } from "@/lib/client";
import { CameraIcon, MicIcon, SendIcon } from "./icons";

export interface Submission {
  text?: string;
  imageBase64?: string;
  imageMediaType?: string;
  modality: "text" | "voice" | "photo";
}

export default function InputBar({
  onSubmit,
  placeholder = "Tell your coach anything…",
  busy = false,
}: {
  onSubmit: (s: Submission) => Promise<void> | void;
  placeholder?: string;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string } | null>(null);

  const voice = useVoice((t) => {
    onSubmit({ text: t, modality: "voice" });
  });

  const submitText = async () => {
    const t = text.trim();
    if (!t && !pendingImage) return;
    setText("");
    const img = pendingImage;
    setPendingImage(null);
    await onSubmit({
      text: t || undefined,
      imageBase64: img?.base64,
      imageMediaType: img?.mediaType,
      modality: img ? "photo" : "text",
    });
  };

  return (
    <div className="flex items-end gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const img = await compressImage(f);
          setPendingImage(img);
          e.target.value = "";
        }}
      />
      <button
        aria-label="Photo"
        onClick={() => fileRef.current?.click()}
        className={`shrink-0 h-11 w-11 rounded-full border grid place-items-center ${
          pendingImage
            ? "bg-accent/20 border-accent text-accent"
            : "bg-surface border-line text-muted"
        }`}
      >
        <CameraIcon size={19} />
      </button>
      <div className="flex-1 flex items-center gap-2 rounded-full border border-line bg-surface px-4 h-11">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitText()}
          placeholder={pendingImage ? "Add a note about the photo…" : placeholder}
          className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted"
          disabled={busy}
        />
        {busy && <span className="text-muted text-xs animate-pulse-soft">…</span>}
      </div>
      {text.trim() || pendingImage ? (
        <button
          aria-label="Send"
          onClick={submitText}
          disabled={busy}
          className="shrink-0 h-11 w-11 rounded-full bg-accent text-black grid place-items-center"
        >
          <SendIcon size={19} />
        </button>
      ) : (
        <button
          aria-label="Voice"
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          disabled={!voice.supported || busy}
          className={`shrink-0 h-11 w-11 rounded-full border grid place-items-center ${
            voice.listening
              ? "bg-danger/20 border-danger text-danger animate-pulse-soft"
              : "bg-surface border-line text-muted"
          } ${!voice.supported ? "opacity-40" : ""}`}
        >
          <MicIcon size={19} />
        </button>
      )}
    </div>
  );
}
