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
    queued: "Queued...",
    searching_initial: "Searching...",
    validating_links: "Validating links...",
    synthesizing: "Synthesizing insights...",
    deep_dive: "Deep diving...",
    complete: "Complete",
    error: "Error",
    idle: "",
  };

  return (
    <div className="research-form">
      <form onSubmit={form.handleSubmit((v) => onStartInitial(v.productUrl, v.timeoutMin))}>
        <div className="form-row">
          <label htmlFor="productUrl">Product URL</label>
          <input
            id="productUrl"
            type="url"
            placeholder="https://vendor.com/product"
            {...form.register("productUrl")}
            disabled={isRunning}
          />
          {form.formState.errors.productUrl && (
            <span className="form-error">{form.formState.errors.productUrl.message}</span>
          )}
        </div>

        <div className="form-row">
          <label htmlFor="timeoutMin">Research Time (minutes)</label>
          <input
            id="timeoutMin"
            type="range"
            min={1}
            max={4}
            step={1}
            defaultValue={4}
            {...form.register("timeoutMin")}
            disabled={isRunning}
          />
          <span className="range-value">{form.watch("timeoutMin") ?? 4} min</span>
        </div>

        <div className="form-actions">
          <button type="submit" disabled={isRunning} className="btn btn-primary">
            {isRunning ? STATUS_LABELS[status as string] : "Generate Listing"}
          </button>

          <button
            type="button"
            disabled={!canDeepDive || isRunning}
            onClick={onStartDeepDive}
            className="btn btn-secondary"
          >
            Continue (Deep Dive)
          </button>
        </div>

        {researchState?.error && (
          <div className="form-error-block" role="alert">
            {researchState.error}
          </div>
        )}
      </form>
    </div>
  );
}
