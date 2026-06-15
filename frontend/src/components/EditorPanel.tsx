"use client";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef } from "react";
import { ResourceGrids } from "@/components/ResourceGrids";
import { LivePreview } from "@/components/LivePreview";
import { ListingSchema, type ListingData } from "@/schemas/listing";
import { useResearchContext } from "@/context/ResearchContext";

export function EditorPanel() {
  const { committedListing } = useResearchContext();
  const methods = useForm<ListingData>({
    resolver: zodResolver(ListingSchema),
    defaultValues: {
      product_name: "",
      vendor_name: "",
      product_description: "",
      vendor_resources: [],
      other_resources: [],
      ai_insights: "",
      support_contacts: [],
      acr_reports: [],
    },
  });

  // Stable ref to methods.reset to avoid stale closure without adding
  // methods to the dependency array (which would cause a loop).
  const resetRef = useRef(methods.reset);
  useEffect(() => {
    resetRef.current = methods.reset;
  });

  useEffect(() => {
    if (committedListing) {
      resetRef.current(committedListing);
    }
  }, [committedListing]);

  return (
    <FormProvider {...methods}>
      <div className="nerd-workspace">
        <div className="nerd-data">
          <div className="resource-grid">
            <h3 className="section-heading">Core Details</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold mb-1">Product Name</label>
                <input className="grid-cell-input border-b-gray-300 border-b" {...methods.register("product_name")} />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">Vendor</label>
                <input className="grid-cell-input border-b-gray-300 border-b" {...methods.register("vendor_name")} />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">Description</label>
                <textarea 
                  className="w-full p-2 border rounded text-sm min-h-[100px]" 
                  {...methods.register("product_description")} 
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-1">AI Insights</label>
                <textarea 
                  className="w-full p-2 border rounded text-sm min-h-[150px] bg-slate-50" 
                  {...methods.register("ai_insights")} 
                />
              </div>
            </div>
          </div>
          
          <ResourceGrids />
        </div>

        <aside className="nerd-preview">
          <LivePreview />
        </aside>
      </div>
    </FormProvider>
  );
}
