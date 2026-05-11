/**
 * GlobalAudioContext.tsx — Shared audio file state across all sections
 * Aivora Platform
 */

import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface GlobalAudioFile {
  name:       string;
  buffer:     AudioBuffer;
  arrayBuffer: ArrayBuffer;
  size:       number;
  uploadedAt: number;
  profile:    "wakeword" | "asr" | "tts" | "conversation";
}

interface GlobalAudioContextValue {
  currentFile:    GlobalAudioFile | null;
  setAudioFile:   (file: File, profile?: GlobalAudioFile["profile"]) => Promise<void>;
  clearAudioFile: () => void;
  loading:        boolean;
  profile:        GlobalAudioFile["profile"];
  setProfile:     (p: GlobalAudioFile["profile"]) => void;
}

const GlobalAudioContext = createContext<GlobalAudioContextValue | null>(null);

export function GlobalAudioProvider({ children }: { children: ReactNode }) {
  const [currentFile, setCurrentFile] = useState<GlobalAudioFile | null>(null);
  const [loading, setLoading]         = useState(false);
  const [profile, setProfile]         = useState<GlobalAudioFile["profile"]>("asr");

  const setAudioFile = useCallback(async (
    file: File,
    prof: GlobalAudioFile["profile"] = profile
  ) => {
    if (!file.name.toLowerCase().endsWith(".wav")) return;
    setLoading(true);
    try {
      const ab  = await file.arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(ab.slice(0));
      setCurrentFile({
        name:        file.name,
        buffer:      buf,
        arrayBuffer: ab,
        size:        file.size,
        uploadedAt:  Date.now(),
        profile:     prof,
      });
      setProfile(prof);
    } catch (e) {
      console.error("GlobalAudioContext: failed to decode", e);
    }
    setLoading(false);
  }, [profile]);

  const clearAudioFile = useCallback(() => setCurrentFile(null), []);

  return (
    <GlobalAudioContext.Provider value={{
      currentFile, setAudioFile, clearAudioFile, loading, profile, setProfile
    }}>
      {children}
    </GlobalAudioContext.Provider>
  );
}

export function useGlobalAudio() {
  const ctx = useContext(GlobalAudioContext);
  if (!ctx) throw new Error("useGlobalAudio must be used inside GlobalAudioProvider");
  return ctx;
}
