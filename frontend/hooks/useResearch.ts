"use client";
import { useState, useCallback, useRef } from "react";
import { ListingData } from "@/lib/types";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { getIdToken } from "@/lib/firebase";
import { debugLog, debugWarn } from "@/lib/debugLog";

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
    debugLog("research", "reset:called");
    abortControllerRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  const stopResearch = useCallback(() => {
    debugLog("research", "stopResearch:called");
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
    debugLog("research", "injectListing:called", { message });
    setState({
      status: "complete",
      log: [message ?? "Injected data from saved candidate."],
      listing: data,
      error: null
    });
  }, []);

  const startResearch = useCallback(async (productUrl: string) => {
    debugLog("research", "startResearch:called", { productUrl });

    // FIX 1: Guard against re-entry while streaming
    if (abortControllerRef.current) {
        debugWarn("research", "startResearch:reentry-abort", { productUrl });
        console.warn("Research already in progress. Aborting previous job.");
        abortControllerRef.current.abort();
    }

    setState({ 
      status: "streaming", 
      log: [`--- Research Started for ${productUrl} ---`, "Queuing research job..."], 
      listing: null, 
      error: null 
    });

    try {
      const token = await getIdToken();
      if (!token && process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true") {
        debugWarn("research", "startResearch:no-token-redirect");
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      
      const authHeader = `Bearer ${token ?? "local-bypass"}`;

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
      debugLog("research", "enqueue:success", { job_id });
      
      setState(prev => ({ 
        ...prev, 
        log: [...prev.log, `Job queued: ${job_id}. Opening SSE stream...`] 
      }));

      const ctrl = new AbortController();
      abortControllerRef.current = ctrl;

      await fetchEventSource(`${API_BASE}/jobs/${job_id}`, {
        headers: { 'Authorization': authHeader },
        signal: ctrl.signal,
        onopen: async (res) => {
          debugLog("sse", "onopen", { status: res.status, job_id });
          if (res.ok) return; 
          throw new Error(`Fatal error from SSE: ${res.status}`);
        },
        onmessage: (msg) => {
          if (msg.event === "status") {
            const data = JSON.parse(msg.data);
            debugLog("sse", "message:status", data);
            setState((prev) => ({
              ...prev,
              log: [...prev.log, data.message ?? data.status],
            }));
          } else if (msg.event === "result") {
            debugLog("sse", "message:result", { job_id });
            const data = JSON.parse(msg.data);
            // Cleanup controller before updating state to prevent race conditions
            abortControllerRef.current = null; 
            ctrl.abort(); 
            setState((prev) => ({
              ...prev,
              status: "complete",
              log: [...prev.log, "Research complete. Hydrating results..."],
              listing: data.parsed_listing,
            }));
          }
        },
        onerror: (err) => {
          // FIX 2: Stop retry loop on error
          if (ctrl.signal.aborted) return;
          debugWarn("sse", "onerror", err);
          console.error("SSE Error:", err);
          setState((prev) => ({
            ...prev,
            status: "error",
            error: "Research stream failed.",
          }));
          throw err; // Stop retries by rethrowing to the fetchEventSource handler
        }
      });

    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        debugLog("research", "startResearch:abort-caught");
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      debugWarn("research", "startResearch:catch", { message });
      setState((prev) => ({ ...prev, status: "error", error: message }));
    }
  }, []);

  return { state, startResearch, reset, stopResearch, updateListing, injectListing };
}