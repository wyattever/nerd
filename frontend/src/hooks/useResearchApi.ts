"use client";

import { useState, useRef, useCallback } from "react";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { auth } from "@/lib/firebase";
import type { ListingData } from "@/schemas/listing";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type JobStatus =
  | "idle"
  | "queued"
  | "searching_initial"
  | "validating_links"
  | "synthesizing"
  | "deep_dive"
  | "complete"
  | "error";

export interface ResearchState {
  status: JobStatus;
  jobId: string | null;
  result: {
    rawMarkdown: string;
    parsedListing: ListingData;
    urlCache: Record<string, string>;
    rejections: string[];
  } | null;
  error: string | null;
}

const INITIAL_STATE: ResearchState = {
  status: "idle",
  jobId: null,
  result: null,
  error: null,
};

export function useResearchApi() {
  const [state, setState] = useState<ResearchState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  const _closeSse = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const _listenToJob = useCallback(async (jobId: string) => {
    _closeSse();
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    const getHeaders = async (forceRefresh = false) => {
      let token = "bypass-token";
      if (process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true") {
        token = (await auth.currentUser?.getIdToken(forceRefresh)) ?? "";
      }
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      };
      if (lastEventIdRef.current) {
        headers["Last-Event-ID"] = lastEventIdRef.current;
      }
      return headers;
    };

    try {
      await fetchEventSource(`${API_BASE}/jobs/${jobId}`, {
        method: "GET",
        headers: await getHeaders(),
        signal: ctrl.signal,
        async onopen(response) {
          if (response.ok) {
            return;
          } else if (response.status === 401) {
            // Token likely expired. Attempt one refresh.
            await auth.currentUser?.getIdToken(true);
            throw new Error("token_refresh_required");
          } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            // Client error, don't retry automatically
            throw new Error(`Fatal error: ${response.status} ${response.statusText}`);
          } else {
            throw new Error(`Server error or timeout: ${response.status}`);
          }
        },
        onmessage(msg) {
          if (msg.id) {
            lastEventIdRef.current = msg.id;
          }
          if (msg.event === "status") {
            const data = JSON.parse(msg.data) as { status: JobStatus };
            setState((prev) => ({ ...prev, status: data.status, jobId }));
          } else if (msg.event === "result") {
            const data = JSON.parse(msg.data);
            setState((prev) => ({
              ...prev,
              status: "complete",
              result: {
                rawMarkdown: data.raw_markdown,
                parsedListing: data.parsed_listing,
                urlCache: data.url_cache,
                rejections: data.rejections ?? [],
              },
            }));
          } else if (msg.event === "end") {
            _closeSse();
          }
        },
        onerror(err) {
          if (err.message === "token_refresh_required") {
            // Re-call _listenToJob to use the new token
            _listenToJob(jobId);
            // Throw to stop the current fetchEventSource retry loop
            throw err; 
          }
          console.error("SSE Error:", err);
          setState((prev) => ({
            ...prev,
            status: "error",
            error: `Connection to research stream lost: ${err.message || "Unknown error"}`,
          }));
          _closeSse();
          throw err;
        },
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      if (err.message === "token_refresh_required") return;
      console.error("fetchEventSource failed:", err);
    }
  }, [_closeSse]);

  const startInitialResearch = useCallback(
    async (productUrl: string, timeoutMin: number = 4) => {
      setState({ ...INITIAL_STATE, status: "queued" });
      lastEventIdRef.current = null;
      try {
        let token = "bypass-token";
        if (process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true") {
          token = (await auth.currentUser?.getIdToken()) ?? "";
        }

        const res = await fetch(`${API_BASE}/research/initial`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ product_url: productUrl, timeout_min: timeoutMin }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const { job_id } = await res.json();
        setState((prev) => ({ ...prev, jobId: job_id }));
        _listenToJob(job_id);
      } catch (err) {
        setState({ ...INITIAL_STATE, status: "error", error: String(err) });
      }
    },
    [_listenToJob]
  );

  const startDeepDive = useCallback(
    async (payload: {
      productUrl: string;
      productName: string;
      currentDraft: string;
      urlCache: Record<string, string>;
      jobId?: string;
    }) => {
      setState((prev) => ({ ...prev, status: "queued", result: null, error: null }));
      lastEventIdRef.current = null;
      try {
        let token = "bypass-token";
        if (process.env.NEXT_PUBLIC_DISABLE_AUTH !== "true") {
          token = (await auth.currentUser?.getIdToken()) ?? "";
        }

        const res = await fetch(`${API_BASE}/research/deep-dive`, {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            product_url: payload.productUrl,
            product_name: payload.productName,
            current_draft: payload.currentDraft,
            url_cache: payload.urlCache,
            job_id: payload.jobId ?? null,
            timeout_min: 4,
          }),
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const { job_id } = await res.json();
        setState((prev) => ({ ...prev, jobId: job_id }));
        _listenToJob(job_id);
      } catch (err) {
        setState({ ...INITIAL_STATE, status: "error", error: String(err) });
      }
    },
    [_listenToJob]
  );

  const reset = useCallback(() => {
    _closeSse();
    setState(INITIAL_STATE);
  }, [_closeSse]);

  return { state, startInitialResearch, startDeepDive, reset };
}
