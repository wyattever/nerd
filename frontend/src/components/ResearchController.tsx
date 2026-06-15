"use client";
import { useEffect } from "react";
import { useResearchApi } from "@/hooks/useResearchApi";
import { ResearchForm } from "@/components/ResearchForm";
import { useResearchContext } from "@/context/ResearchContext";

export function ResearchController() {
  const { state, startInitialResearch, startDeepDive } = useResearchApi();
  const { onStreamStart, onStreamComplete } = useResearchContext();

  useEffect(() => {
    // Mapping internal hook statuses to the context 'isStreaming' state
    const isActive = ["queued", "searching_initial", "validating_links", "synthesizing", "deep_dive"].includes(state.status);
    
    if (isActive) {
      onStreamStart();
    }
    
    if (state.status === "complete" && state.result?.parsedListing) {
      onStreamComplete(state.result.parsedListing);
    }
  }, [state.status, state.result, onStreamStart, onStreamComplete]);

  return (
    <ResearchForm
      researchState={state}
      onStartInitial={startInitialResearch}
      // Deep dive requires data from the EditorPanel. 
      // For now, we provide a no-op to satisfy the prop until context bridge is refined if needed.
      onStartDeepDive={() => console.warn("Deep Dive requires editor state integration")}
      methods={null}
    />
  );
}
