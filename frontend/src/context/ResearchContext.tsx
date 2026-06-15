"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { ListingData } from "@/schemas/listing";

interface ResearchContextValue {
  isStreaming: boolean;
  committedListing: ListingData | null;
  onStreamStart: () => void;
  onStreamComplete: (listing: ListingData) => void;
}

const ResearchContext = createContext<ResearchContextValue | null>(null);

export function ResearchProvider({ children }: { children: ReactNode }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [committedListing, setCommittedListing] = useState<ListingData | null>(null);

  const onStreamStart = useCallback(() => setIsStreaming(true), []);
  const onStreamComplete = useCallback((listing: ListingData) => {
    setCommittedListing(listing);
    setIsStreaming(false);
  }, []);

  return (
    <ResearchContext.Provider
      value={{ isStreaming, committedListing, onStreamStart, onStreamComplete }}
    >
      {children}
    </ResearchContext.Provider>
  );
}

export function useResearchContext() {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error("useResearchContext must be used inside ResearchProvider");
  return ctx;
}
