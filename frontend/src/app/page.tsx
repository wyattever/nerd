"use client";

import { useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListingDataSchema, type ListingData } from "@/schemas/listing";
import { useResearchApi } from "@/hooks/useResearchApi";
import { ResearchForm } from "@/components/ResearchForm";
import { ResourceGrids } from "@/components/ResourceGrids";
import { LivePreview } from "@/components/LivePreview";

export default function NerdPage() {
  const { state, startInitialResearch, startDeepDive, reset } = useResearchApi();

  const methods = useForm<ListingData>({
    resolver: zodResolver(ListingDataSchema),
    defaultValues: ListingDataSchema.parse({}),
  });

  // Hydrate React Hook Form when SSE result arrives
  useEffect(() => {
    // Safe access to state.result?.parsedListing
    if (state?.status === "complete" && state?.result?.parsedListing) {
      methods.reset(state.result.parsedListing);
    }
  }, [state?.status, state?.result, methods]);

  const handleDeepDive = () => {
    // Safe access to state.result
    if (!state?.result) return;
    startDeepDive({
      productUrl: state.result.parsedListing.product_website_url,
      productName: state.result.parsedListing.product_name,
      currentDraft: state.result.rawMarkdown,
      urlCache: state.result.urlCache,
      jobId: state.jobId ?? undefined,
    });
  };

  return (
    <FormProvider {...methods}>
      <main className="nerd-layout">
        <header className="nerd-header">
          <h1>N.E.R.D.</h1>
          <p className="nerd-subtitle">Ncademi Edtech Research &amp; Data</p>
        </header>

        <section className="nerd-controls" aria-label="Research controls">
          <ResearchForm
            researchState={state}
            onStartInitial={startInitialResearch}
            onStartDeepDive={handleDeepDive}
            methods={methods}
          />
        </section>

        <div className="nerd-workspace">
          <section className="nerd-data" aria-label="Listing data">
            <ResourceGrids />
          </section>

          <section className="nerd-preview" aria-label="Live preview">
            <LivePreview />
          </section>
        </div>
      </main>
    </FormProvider>
  );
}
