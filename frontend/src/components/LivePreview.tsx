"use client";

import { useEffect, useRef, useState } from "react";
import { useWatch, useFormContext } from "react-hook-form";
import type { ListingData } from "@/schemas/listing";
import { useResearchContext } from "@/context/ResearchContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const DEBOUNCE_MS = 600;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function LivePreview() {
  const { isStreaming } = useResearchContext();
  const { control } = useFormContext<ListingData>();
  const formValues = useWatch({ control }) as ListingData;
  const debouncedValues = useDebounce(formValues, DEBOUNCE_MS);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [lastHtml, setLastHtml] = useState<string>("");
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    // Do not fire /render while SSE is in progress.
    if (isStreaming || !debouncedValues?.product_name) return;

    let cancelled = false;
    setRendering(true);

    fetch(`${API_BASE}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(debouncedValues),
    })
      .then((r) => r.json())
      .then((data: { html: string }) => {
        if (cancelled) return;
        // DOMPurify is client-only — dynamic import to avoid SSR crash
        import("dompurify").then(({ default: DOMPurify }) => {
          const clean = DOMPurify.sanitize(data.html, {
            ADD_TAGS: ["style"],
            ADD_ATTR: ["target"],
            FORCE_BODY: true,
          });
          setLastHtml(clean);
          if (iframeRef.current) {
            iframeRef.current.srcdoc = clean;
          }
        });
      })
      .catch(() => {
        // Silently retain last good render on error
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedValues, isStreaming]);

  const copyHtml = () => {
    if (lastHtml) navigator.clipboard.writeText(lastHtml);
  };

  return (
    <section className="live-preview" aria-label="Research Result Preview">
      <div className="preview-toolbar">
        <span className="preview-label">
          Live Preview {rendering && <span className="preview-spinner" aria-label="Rendering" />}
        </span>
        <button
          type="button"
          className="btn btn-ghost px-3 py-1 text-sm border rounded hover:bg-gray-100 focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-50"
          onClick={copyHtml}
          disabled={!lastHtml}
        >
          Copy HTML
        </button>
      </div>
      <iframe
        ref={iframeRef}
        title="NCADEMI Listing Preview"
        sandbox="allow-same-origin"
        className="preview-frame w-full border rounded mt-2"
        style={{ minHeight: "500px" }}
        srcDoc={lastHtml || "<p style='padding:1rem;color:#888'>Preview will appear here after research or manual edits.</p>"}
      />
    </section>
  );
}
