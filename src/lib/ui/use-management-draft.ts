"use client";

import { createContext, useContext, useEffect, useState } from "react";

export const ManagementDraftScope = createContext("");
const prefix = "morita:management-draft:v1:";
const maxAge = 7 * 24 * 60 * 60 * 1000;
export function clearManagementDraft(scope: string, kind: string) {
  try { sessionStorage.removeItem(`${prefix}${scope}:${kind}`); } catch { /* Optional browser storage. */ }
}

export function decodeManagementDraft<T>(raw: string | null, validate: (value: unknown) => T | null, now = Date.now()): T | null {
  try {
    if (!raw || raw.length > 2_000_000) return null;
    const envelope = JSON.parse(raw);
    if (envelope.version !== 1 || !Number.isFinite(envelope.savedAt) || now - envelope.savedAt > maxAge || envelope.savedAt > now + 60_000) return null;
    return validate(envelope.value);
  } catch { return null; }
}

export function useManagementDraft<T>(kind: string, value: T, hasContent: boolean, validate: (value: unknown) => T | null) {
  const scope = useContext(ManagementDraftScope);
  const key = `${prefix}${scope}:${kind}`;
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState<T | null>(null);
  const [cleared, setCleared] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try { setRecovered(decodeManagementDraft(sessionStorage.getItem(key), validate)); }
      catch { setUnavailable(true); }
      setReady(true);
    });
    return () => { active = false; };
  }, [key, validate]);
  useEffect(() => {
    if (!scope || !ready || recovered || cleared) return;
    try {
      if (hasContent) sessionStorage.setItem(key, JSON.stringify({ version: 1, savedAt: Date.now(), value }));
      else sessionStorage.removeItem(key);
    } catch { Promise.resolve().then(() => setUnavailable(true)); }
  }, [scope, key, ready, recovered, cleared, hasContent, value]);
  function clear() {
    clearManagementDraft(scope, kind);
    setRecovered(null);
    setCleared(true);
  }
  return { ready, recovered, unavailable, clear, resolve: () => setRecovered(null) };
}
