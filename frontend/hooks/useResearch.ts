"use client";
import { useState, useCallback, useRef } from "react";
import { ListingData } from "@/lib/types";

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
  const eventSourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    setState(INITIAL_STATE);
  }, []);

  const startResearch = useCallback(async (productUrl: string) => {
    setState({ status: "streaming", log: ["Starting research..."], listing: null, error: null });

    try {
      // Step 1: enqueue the job
      const enqueueRes = await fetch(`${API_BASE}/research/initial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_url: productUrl, timeout_min: 4 }),
      });

      if (!enqueueRes.ok) throw new Error(`Enqueue failed: ${enqueueRes.status}`);
      const { job_id } = await enqueueRes.json();

      // Step 2: open SSE stream for this job
      const es = new EventSource(`${API_BASE}/jobs/${job_id}`);
      eventSourceRef.current = es;

      es.addEventListener("status", (e) => {
        const data = JSON.parse(e.data);
        setState((prev) => ({
          ...prev,
          log: [...prev.log, data.message ?? data.status],
        }));
      });

      es.addEventListener("result", (e) => {
        const data = JSON.parse(e.data);
        es.close();
        setState((prev) => ({
          ...prev,
          status: "complete",
          listing: data.parsed_listing,
        }));
      });

      es.addEventListener("error", (e) => {
        es.close();
        setState((prev) => ({
          ...prev,
          status: "error",
          error: "Research failed. Check the API logs.",
        }));
      });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState((prev) => ({ ...prev, status: "error", error: message }));
    }
  }, []);

  return { state, startResearch, reset };
}
