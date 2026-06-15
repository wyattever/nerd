"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ListingData } from "@/schemas/listing";
import type { ResearchState } from "@/hooks/useResearchApi";

const FormSchema = z.object({
  productUrl: z.string().url("Please enter a valid URL"),
  timeoutMin: z.coerce.number().min(1).max(4).default(4),
});
type FormValues = z.infer<typeof FormSchema>;

interface ResearchFormProps {
  researchState: ResearchState;
  onStartInitial: (url: string, timeout: number) => void;
  onStartDeepDive: () => void;
  methods: any;
}

export function ResearchForm({
  researchState,
  onStartInitial,
  onStartDeepDive,
  methods,
}: ResearchFormProps) {
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema) });
  
  // Safe destructuring to prevent "Cannot destructure property status"
  const { status = "idle", result = null } = researchState || {};

  const isRunning =
    status === "queued" ||
    status === "searching_initial" ||
    status === "validating_links" ||
    status === "synthesizing" ||
    status === "deep_dive";

  const canDeepDive = status === "complete" && result !== null;

  const STATUS_LABELS: Record<string, string> = {
    queued: "Research queued. Waiting for worker...",
    searching_initial: "Searching initial sources and vendor site...",
    validating_links: "Validating discovered resource links...",
    synthesizing: "Synthesizing research into listing draft...",
    deep_dive: "Performing deep dive research on missing details...",
    complete: "Research complete.",
    error: "An error occurred during research.",
    idle: "Ready to start research.",
  };

  return (
    <div className="research-form">
      {/* Hidden ARIA live region for status updates */}
      <div className="sr-only" aria-live="polite">
        {status !== "idle" && `Status: ${STATUS_LABELS[status as string]}`}
      </div>

      <form onSubmit={form.handleSubmit((v) => onStartInitial(v.productUrl, v.timeoutMin))}>
        <div className="form-row">
          <label htmlFor="productUrl" className="block text-sm font-medium mb-1">Product URL</label>
          <input
            id="productUrl"
            type="url"
            placeholder="https://vendor.com/product"
            {...form.register("productUrl")}
            disabled={isRunning}
            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100"
          />
          {form.formState.errors.productUrl && (
            <span className="form-error text-red-600 text-sm mt-1" role="alert">
              {form.formState.errors.productUrl.message}
            </span>
          )}
        </div>

        <div className="form-row mt-4">
          <label htmlFor="timeoutMin" className="block text-sm font-medium mb-1">Research Time (minutes)</label>
          <input
            id="timeoutMin"
            type="range"
            min={1}
            max={4}
            step={1}
            defaultValue={4}
            {...form.register("timeoutMin")}
            disabled={isRunning}
            className="w-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <span className="range-value text-sm text-gray-600">{form.watch("timeoutMin") ?? 4} min</span>
        </div>

        <div className="form-actions mt-6 flex gap-3">
          <button 
            type="submit" 
            disabled={isRunning} 
            className="btn btn-primary px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
          >
            {isRunning ? (status === "queued" ? "Queued..." : "Researching...") : "Generate Listing"}
          </button>

          <button
            type="button"
            disabled={!canDeepDive || isRunning}
            onClick={onStartDeepDive}
            className="btn btn-secondary px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
          >
            Continue (Deep Dive)
          </button>
        </div>

        {researchState?.error && (
          <div className="form-error-block mt-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded" role="alert">
            <strong>Error:</strong> {researchState.error}
          </div>
        )}
      </form>
    </div>
  );
}
