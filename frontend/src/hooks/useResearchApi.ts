"use client";

import { useState, useRef, useCallback } from "react";
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
  const sseRef = useRef<EventSource | null>(null);

  const _closeSse = () => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  };

  const _listenToJob = useCallback((jobId: string) => {
    _closeSse();
    const sse = new EventSource(`${API_BASE}/jobs/${jobId}`);
    sseRef.current = sse;

    sse.addEventListener("status", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { status: JobStatus };
      setState((prev) => ({ ...prev, status: data.status, jobId }));
    });

    sse.addEventListener("result", (e: MessageEvent) => {
      const data = JSON.parse(e.data);
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
    });

    sse.addEventListener("end", () => {
      _closeSse();
    });

    sse.onerror = () => {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: "Connection to job stream lost.",
      }));
      _closeSse();
    };
  }, []);

  const startInitialResearch = useCallback(
    async (productUrl: string, timeoutMin: number = 4) => {
      setState({ ...INITIAL_STATE, status: "queued" });
      try {
        const res = await fetch(`${API_BASE}/research/initial`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
      try {
        const res = await fetch(`${API_BASE}/research/deep-dive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        setState((prev) => ({ ...prev, status: "error", error: String(err) }));
      }
    },
    [_listenToJob]
  );

  const reset = useCallback(() => {
    _closeSse();
    setState(INITIAL_STATE);
  }, []);

  return { state, startInitialResearch, startDeepDive, reset };
}
