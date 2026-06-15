"use client";
import { useState } from "react";
import { useResearch } from "@/hooks/useResearch";
import { ListingCard } from "@/components/ListingCard";
import { InvalidLinksModal } from "@/components/InvalidLinksModal";
import { InvalidLink } from "@/lib/types";
import { buildNcademiPreviewHtml } from "@/lib/ncademiPreview";

export default function Home() {
  const { state, startResearch, reset, updateListing } = useResearch();
  const [url, setUrl] = useState("");
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [invalidLinks, setInvalidLinks] = useState<InvalidLink[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) startResearch(url.trim());
  };

  const handleValidateLinks = async () => {
    if (!state.listing) return;
    setIsValidating(true);

    try {
      const listing = state.listing;
      const candidateLinks: InvalidLink[] = [
        ...listing.vendor_resources.map(r => ({
          section: `From ${listing.vendor_name || "Vendor"}`,
          text: r.text,
          url: r.url,
        })),
        ...listing.other_resources.map(r => ({
          section: "From Other Sources",
          text: r.text,
          url: r.url,
        })),
        ...listing.support_contacts
          .filter(c => c.type === "url")
          .map(c => ({
            section: "Support",
            text: c.label || c.value,
            url: c.value,
          })),
        ...listing.acr_reports.map(a => ({
          section: "Accessibility Conformance Reports",
          text: a.title,
          url: a.url,
        })),
      ];

      const candidateUrls = candidateLinks.map(link => link.url);

      if (candidateUrls.length === 0) {
        setIsValidating(false);
        return;
      }

      // Step 2: Dispatch a single POST request to the new FastAPI endpoint
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/research/validate-links-async`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-bypass'
        },
        body: JSON.stringify({ urls: candidateUrls }),
      });

      if (!response.ok) {
        throw new Error(`Validation service failed with status: ${response.status}`);
      }

      const { job_id } = await response.json();

      // Step 3: Poll for completion
      let results = null;
      while (true) {
        const statusRes = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/research/validate-links/${job_id}`, {
          headers: { 'Authorization': 'Bearer local-bypass' }
        });
        const statusData = await statusRes.json();
        
        if (statusData.status === 'complete') {
          results = statusData.results;
          break;
        } else if (statusData.status === 'error') {
          throw new Error(statusData.error || "Validation job failed");
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Step 4: Map the backend's detailed results back to the UI interface
      const brokenLinksToDisplay = candidateLinks
        .map(link => {
          const res = results[link.url];
          if (res && !res.is_valid) {
            return {
              ...link,
              reason: res.reason,
              screenshot_path: res.screenshot_path ? `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}${res.screenshot_path}` : undefined
            };
          }
          return null;
        })
        .filter((l): l is InvalidLink => l !== null);

      // Step 5: Update the UI state with the final grouped/mapped invalid links
      setInvalidLinks(brokenLinksToDisplay);
      setShowValidationModal(true);

    } catch (error) {
      console.error("Link validation encountered an error:", error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleApplyChanges = (toDelete: InvalidLink[], toAdd: { section: string, text: string, url: string }[]) => {
    if (!state.listing) return;

    const toDeleteUrls = new Set(toDelete.map(l => l.url));

    let updated = {
      ...state.listing,
      vendor_resources: state.listing.vendor_resources.filter(
        r => !toDeleteUrls.has(r.url)
      ),
      other_resources: state.listing.other_resources.filter(
        r => !toDeleteUrls.has(r.url)
      ),
      support_contacts: state.listing.support_contacts.filter(
        c => !toDeleteUrls.has(c.value)
      ),
      acr_reports: state.listing.acr_reports.filter(
        a => !toDeleteUrls.has(a.url)
      ),
    };

    // Append new links
    toAdd.forEach(link => {
      if (link.section === "vendor") {
        updated.vendor_resources.push({ text: link.text, url: link.url });
      } else if (link.section === "other") {
        updated.other_resources.push({ text: link.text, url: link.url });
      } else if (link.section === "support") {
        updated.support_contacts.push({ type: "url", value: link.url, label: link.text });
      } else if (link.section === "acr") {
        updated.acr_reports.push({ title: link.text, url: link.url });
      }
    });

    updateListing(updated);
  };

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          N.E.R.D. — NCADEMI EdTech Research Tool
        </h1>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* Input — always visible when idle or errored */}
        {(state.status === "idle" || state.status === "error") && (
          <section aria-label="Research input">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <label htmlFor="product-url" className="sr-only">Product URL</label>
              <input
                id="product-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://vendor.com/product"
                required
                className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="bg-blue-700 text-white text-sm font-medium px-5 py-2
                           rounded hover:bg-blue-800 focus:outline-none
                           focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Generate Listing
              </button>
            </form>
            {state.status === "error" && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {state.error}
              </p>
            )}
          </section>
        )}

        {/* Streaming phase — terminal only, nothing else in DOM */}
        {state.status === "streaming" && (
          <section aria-label="Research progress">
            <div
              role="status"
              aria-live="polite"
              aria-label="Research progress log"
              className="bg-gray-900 text-green-400 font-mono text-sm rounded p-4
                         h-64 overflow-y-auto space-y-1"
            >
              {state.log.map((line, i) => (
                <p key={i}>
                  <span className="text-gray-500 select-none mr-2">›</span>
                  {line}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* Results phase — static read-only listing */}
        {state.status === "complete" && state.listing && (
          <>
            {/* Action bar - Now above the results */}
            <div className="flex gap-3" role="toolbar" aria-label="Listing actions">
              <button
                onClick={() => {
                  // Fetch rendered HTML from /render and copy to clipboard
                  fetch(
                    `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/render`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(state.listing),
                    }
                  )
                    .then((r) => r.json())
                    .then((d) => navigator.clipboard.writeText(d.html));
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Copy HTML
              </button>
              <button
                onClick={() => {
                  fetch(
                    `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/render`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(state.listing),
                    }
                  )
                    .then((r) => r.json())
                    .then((d) => {
                      const blob = new Blob([d.html], { type: "text/html" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${state.listing?.product_name ?? "listing"}.html`;
                      a.click();
                    });
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Download HTML
              </button>
              <button
                onClick={handleValidateLinks}
                disabled={isValidating}
                aria-disabled={isValidating}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isValidating ? "Validating..." : "Validate Links"}
              </button>
              <button
                onClick={reset}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                New Research
              </button>
            </div>

            <section aria-label="Research results">
              <div className="relative bg-white border border-gray-200 rounded-lg p-6">

                {/* Preview button — top-right corner of the card */}
                <div className="absolute top-4 right-4">
                  <button
                    onClick={() => {
                      const html = buildNcademiPreviewHtml(state.listing!);
                      const blob = new Blob([html], { type: "text/html" });
                      const url = URL.createObjectURL(blob);
                      window.open(url, "_blank", "noopener,noreferrer");
                      // Revoke after a short delay to allow the tab to load
                      setTimeout(() => URL.revokeObjectURL(url), 10000);
                    }}
                    aria-label="Preview as NCADEMI product page (opens in new tab)"
                    title="Preview as NCADEMI product page"
                    className="inline-flex items-center gap-1.5 text-xs text-gray-600
                               border border-gray-300 rounded px-2.5 py-1.5
                               hover:bg-gray-50 focus:outline-none focus:ring-2
                               focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Preview
                    {/* External link / open in new tab icon */}
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"
                      fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7"/>
                      <path d="M8 1h3v3"/>
                      <path d="M11 1L5.5 6.5"/>
                    </svg>
                  </button>
                </div>

                <ListingCard listing={state.listing} />
              </div>
            </section>
          </>
        )}

      </main>

      {showValidationModal && (
        <InvalidLinksModal
          links={invalidLinks}
          vendorName={state.listing?.vendor_name || ""}
          onClose={() => setShowValidationModal(false)}
          onApplyChanges={handleApplyChanges}
        />
      )}
    </div>
  );
}
