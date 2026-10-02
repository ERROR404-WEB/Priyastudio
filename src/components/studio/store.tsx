'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, errorMessage, requestJSON } from '@/lib/client';
import type { Command, StudioState } from '@/lib/types';
import { Flower2, LoaderCircle } from 'lucide-react';

interface StudioContextValue {
  state: StudioState; demo: boolean; pending: boolean; error: string | null;
  clearError: () => void; refresh: () => Promise<void>;
  mutate: (command: Command) => Promise<StudioState>;
  share: (targetId: string, scope: 'proposal' | 'review') => Promise<string>;
  search: string; setSearch: (value: string) => void;
}
const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState('');
  const inFlight = useRef(false);
  const router = useRouter();

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { router.replace('/login'); return; }
    setError(errorMessage(error));
    if (error instanceof ApiError) setStatus(error.status);
  }, [router]);
  const acceptState = useCallback((incoming: StudioState) => {
    setState((current) => current && current.revision > incoming.revision ? current : incoming);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const result = await requestJSON<{ state: StudioState; demo: boolean }>('/api/studio');
      acceptState(result.state); setDemo(result.demo); setError(null); setStatus(null);
    } catch (error) { handleError(error); }
    finally { setLoading(false); }
  }, [acceptState, handleError]);
  useEffect(() => {
    const controller = new AbortController();
    void requestJSON<{ state: StudioState; demo: boolean }>('/api/studio', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        acceptState(result.state); setDemo(result.demo); setError(null); setStatus(null); setLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        handleError(error); setLoading(false);
      });
    return () => controller.abort();
  }, [acceptState, handleError]);
  useEffect(() => {
    const onFocus = () => { if (!inFlight.current) void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  async function write<T extends { state: StudioState }>(url: string, body: unknown): Promise<T> {
    if (inFlight.current) throw new Error('A save is already in progress. Please wait.');
    inFlight.current = true; setPending(true); setError(null);
    try {
      const result = await requestJSON<T>(url, { method: 'POST', body: JSON.stringify(body) });
      acceptState(result.state); return result;
    } catch (error) { handleError(error); throw error; }
    finally { inFlight.current = false; setPending(false); }
  }
  async function mutate(command: Command) {
    return (await write<{ state: StudioState }>('/api/studio', { command })).state;
  }
  async function share(targetId: string, scope: 'proposal' | 'review') {
    return (await write<{ state: StudioState; shareUrl: string }>('/api/studio/share', { targetId, scope })).shareUrl;
  }

  if (!state) return <div className="studio-gate"><Flower2 size={42} strokeWidth={1} />
    <span className="studio-eyebrow">HEY PRIYA · CREATOR STUDIO</span>
    <h1>{loading ? 'Making room for your next idea.' : status === 503 ? 'Your studio is almost ready.' : 'A little pause.'}</h1>
    {loading ? <p role="status"><LoaderCircle className="studio-spin" size={20} /> Opening your workspace…</p> : <><p role="alert">{error || 'Please sign in to open your studio.'}</p>{status === 503 && <p>Ask the owner to finish the database and single-admin setup. Production never falls back to demo data.</p>}<button className="studio-button" onClick={() => { setLoading(true); void refresh(); }}>Try again</button></>}
  </div>;
  return <StudioContext.Provider value={{ state, demo, pending, error, clearError: () => setError(null), refresh, mutate, share, search, setSearch }}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const context = useContext(StudioContext);
  if (!context) throw new Error('Studio pages must be inside StudioProvider.');
  return context;
}

export function useOptionalStudio(): StudioContextValue | null {
  return useContext(StudioContext);
}


export function matchesSearch(search: string, ...values: (string | undefined)[]): boolean {
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase();
  return search.trim().toLocaleLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}