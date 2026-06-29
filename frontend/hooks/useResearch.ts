"use client";
import { useState, useCallback, useRef } from "react";
import { ListingData } from "@/lib/types";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { getIdToken } from "@/lib/firebase";

export type ResearchStatus = "idle" | "streaming" | "complete" | "error";

export interface ResearchState {
  status: ResearchStatus;
  log: string[];
  listing: ListingData | null;
  error: string | null;
}

const INITIAL_STATE: ResearchState = {
  status: "idle",
  log: [],
  listing: null,
  error: null,
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export function useResearch() {
  const [state, setState] = useState<ResearchState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const stopResearch = useCallback(() => {
    abortControllerRef.current?.abort();
    setState(prev => ({
      ...prev,
      status: "idle",
      log: [...prev.log, "Research stopped by user."],
    }));
  }, []);

  const updateListing = useCallback(
    (update: ListingData | ((prev: ListingData | null) => ListingData)) => {
      setState(prev => ({
        ...prev,
        listing: typeof update === "function" ? update(prev.listing) : update,
      }));
    },
    []
  );

  const injectListing = useCallback((data: ListingData, message?: string) => {
    setState({
      status: "complete",
      log: [message ?? "Injected data from saved candidate."],
      listing: data,
      error: null
    });
  }, []);

  const startResearch = useCallback(async (productUrl: string) => {
    setState({ 
      status: "streaming", 
      log: [`--- Research Started for ${productUrl} ---`, "Queuing research job..."], 
      listing: null, 
      error: null 
    });

    try {
      // Get the token (handles local bypass via getIdToken)
      const token = await getIdToken();
      if (!token && process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true") {
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      
      const authHeader = `Bearer ${token ?? "local-bypass"}`;

      // Step 1: enqueue the job
      const enqueueRes = await fetch(`${API_BASE}/research/initial`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": authHeader
        },
        body: JSON.stringify({ product_url: productUrl, timeout_min: 4 }),
      });

      if (!enqueueRes.ok) throw new Error(`Enqueue failed: ${enqueueRes.status}`);
      const { job_id } = await enqueueRes.json();
      
      setState(prev => ({ 
        ...prev, 
        log: [...prev.log, `Job queued: ${job_id}. Opening SSE stream...`] 
      }));

      // Step 2: open SSE stream for this job using fetchEventSource
      const ctrl = new AbortController();
      abortControllerRef.current = ctrl;

      await fetchEventSource(`${API_BASE}/jobs/${job_id}`, {
        headers: { 'Authorization': authHeader },
        signal: ctrl.signal,
        onopen: async (res) => {
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            if (res.status === 401) {
               // Token might be expired, though getIdToken(true) above should prevent this.
               // We could attempt a retry loop here if needed.
            }
            throw new Error(`Fatal error from SSE: ${res.status}`);
          }
        },
        onmessage: (msg) => {
          if (msg.event === "status") {
            const data = JSON.parse(msg.data);
            setState((prev) => ({
              ...prev,
              log: [...prev.log, data.message ?? data.status],
            }));
          } else if (msg.event === "result") {
            const data = JSON.parse(msg.data);
            ctrl.abort(); // Close the stream
            setState((prev) => ({
              ...prev,
              status: "complete",
              log: [...prev.log, "Research complete. Hydrating results..."],
              listing: data.parsed_listing,
            }));
          }
        },
        onerror: (err) => {
          // fetch-event-source retries by default.
          if (ctrl.signal.aborted) return; // ignore if we closed it
          console.error("SSE Error:", err);
          setState((prev) => ({
            ...prev,
            status: "error",
            error: "Research stream failed. Check API logs.",
          }));
          throw err; // rethrow to stop or allow retry
        }
      });

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setState((prev) => ({ ...prev, status: "error", error: message }));
    }
  }, []);

  return { state, startResearch, reset, stopResearch, updateListing, injectListing };
}
