"use client";
import { useState } from "react";
import { useResearch } from "@/hooks/useResearch";
import { ListingCard } from "@/components/ListingCard";

export default function Home() {
  const { state, startResearch, reset } = useResearch();
  const [url, setUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) startResearch(url.trim());
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
            <section aria-label="Research results">
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <ListingCard listing={state.listing} />
              </div>
            </section>

            {/* Footer action bar */}
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
                onClick={reset}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                New Research
              </button>
            </div>
          </>
        )}

      </main>
    </div>
  );
}
