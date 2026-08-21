// frontend/app/page.tsx
"use client";
import { debugLog } from "@/lib/debugLog";
import { useState, useEffect, useRef, useCallback } from "react";
import { useResearch } from "@/hooks/useResearch";
import { ListingCard } from "@/components/ListingCard";
import { ListingData, SectionKey } from "@/lib/types";
import { SectionEditor } from "@/components/SectionEditor";
import { getSectionHtml } from "@/lib/ncademiPreview";
import { getIdToken } from "@/lib/firebase";
import { ImportDataModal } from "@/components/ImportDataModal";
import { IngestDraftResponse } from "@/lib/types";
import {
  getPublishedProducts,
  getPublishedProductHeader,
  getAddedProducts,
  getAddedProductHeader,
  getCandidateProducts,
  getCandidateProductHeader,
  getVendorResourcesForProduct,
  getOtherResourcesForProduct,
  getSupportContactsForProduct,
} from "@/lib/appsheet-tables";

interface CandidateRef {
  name: string;
  slug: string;
  url: string;
}

const SECTION_KEYS: { key: SectionKey; label: string }[] = [
  { key: "header", label: "Header" },
  { key: "vendor_resources", label: "Vendor Resources" },
  { key: "other_resources", label: "Other Resources" },
  { key: "support", label: "Support" },
  { key: "acr", label: "ACR" },
];

function diagnosticLines(result: IngestDraftResponse): string[] {
  // See nerd-import-data-architecture-v4.md §6.1-6.2: rejections (flagged,
  // retained) and drops (removed, data loss) are reported as distinct
  // groups, never merged into a single count.
  const { diagnostics, rejections } = result;
  const lines: string[] = [];

  const vendorDropped = diagnostics.parsed_vendor_count - diagnostics.surviving_vendor_count;
  const otherDropped = diagnostics.parsed_other_count - diagnostics.surviving_other_count;

  if (vendorDropped > 0 || otherDropped > 0) {
    lines.push(
      `WARNING: ${vendorDropped + otherDropped} resource(s) dropped during validation (failed liveness check).`
    );
    diagnostics.dropped_urls.forEach(u => lines.push(`  - Dropped: ${u}`));
  } else {
    lines.push("All parsed resources passed validation -- none dropped.");
  }

  if (diagnostics.acr_reset) {
    lines.push("WARNING: ACR report failed validation and was reset to 'None found'.");
  }

  if (rejections.length > 0) {
    lines.push(`${rejections.length} link(s) flagged for manual verification (not removed):`);
    rejections.forEach(r => lines.push(`  - ${r}`));
  }

  lines.push(`Vendor resources: ${diagnostics.surviving_vendor_count} of ${diagnostics.parsed_vendor_count} parsed.`);
  lines.push(`Other resources: ${diagnostics.surviving_other_count} of ${diagnostics.parsed_other_count} parsed.`);

  return lines;
}

// Builds a ListingData to inject into the Viewer for the read-only product
// dropdowns (Published / Added / Candidate Products). Assembles header
// fields, vendor/other resources, and support contacts from whatever data
// source backs these dropdowns -- currently the AppSheet recovery tables
// (see appsheet-tables.ts), but this function's shape/name is intentionally
// source-agnostic since that data source is expected to be replaced.
// ACR remains empty for this data path -- not yet wired.
function populateViewerListing(
  header: {
    product_name: string;
    vendor_name: string;
    vendor_directory_url: string;
    product_description: string;
    product_website_url: string;
  },
  vendorResources: { text: string; url: string }[],
  otherResources: { text: string; url: string }[],
  supportContacts: { type: "email" | "url"; value: string; label?: string }[]
): ListingData {
  return {
    ...header,
    vendor_resources: vendorResources,
    other_resources: otherResources,
    support_contacts: supportContacts,
    acr_reports: [],
    last_updated: "",
  } as unknown as ListingData;
}

export default function Home() {
  const { state, startResearch, reset, stopResearch, updateListing, injectListing } = useResearch();
  const [url, setUrl] = useState("");
  const [candidates, setCandidates] = useState<CandidateRef[]>([]);

  // NOTE: Published / Added / Candidate Products dropdowns are populated
  // from the static AppSheet global table (see appsheet-tables.ts) and
  // wire ONLY the header section of the Viewer -- vendor/other resources,
  // support, and ACR remain empty for these three data paths.
  const [publishedProducts] = useState<{ name: string; slug: string }[]>(() =>
    getPublishedProducts()
  );
  const [addedProducts] = useState<{ name: string; slug: string }[]>(() =>
    getAddedProducts()
  );
  const [candidateProducts] = useState<{ name: string; slug: string }[]>(() =>
    getCandidateProducts()
  );

  const [selectedPublishedSlug, setSelectedPublishedSlug] = useState("");
  const [selectedAddedSlug, setSelectedAddedSlug] = useState("");
  const [selectedCandidateProductSlug, setSelectedCandidateProductSlug] = useState("");

  // Legacy backend-driven Candidates widget -- untouched functionality,
  // relabeled "NCADEMI Candidates (legacy)" per product decision.
  const [selectedSlug, setSelectedSlug] = useState("");
  // Ensures only one product dropdown carries a selection at a time --
  // selecting in any of the four resets the other three, so their "View"
  // buttons revert to disabled/inactive.
  const clearAllProductSelections = () => {
    setSelectedPublishedSlug("");
    setSelectedAddedSlug("");
    setSelectedCandidateProductSlug("");
    setSelectedSlug("");
  };

  const [activeCandidateSlug, setActiveCandidateSlug] = useState<string | null>(null);
  const [isProductLoaded, setIsProductLoaded] = useState(false);
  const [processHeading, setProcessHeading] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ [key: string]: string }>({});
  const [isDirty, setIsDirty] = useState(false);
  const [localLog, setLocalLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [editorOpenCount, setEditorOpenCount] = useState(0);
  const [unsavedSections, setUnsavedSections] = useState<Set<SectionKey>>(new Set());

  const handleSaveSection = (key: SectionKey, html: string) => {
    updateListing(prev => {
      if (!prev) throw new Error("Cannot save section: listing is null");
      return {
        ...prev,
        section_overrides: {
          ...prev.section_overrides,
          [key]: html,
        },
      };
    });
    setIsDirty(true);
    setUnsavedSections(prev => new Set(prev).add(key));
  };

  const handleResetSection = (key: SectionKey) => {
    updateListing(prev => {
      if (!prev) throw new Error("Cannot reset section: listing is null");
      const { [key]: _, ...rest } = prev.section_overrides ?? {};
      return {
        ...prev,
        section_overrides: rest,
      };
    });
    setIsDirty(true);
    setUnsavedSections(prev => new Set(prev).add(key));
  };

  const refreshLists = useCallback(async () => {
    debugLog("lists", "refreshLists:called");
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    try {
      const token = await getIdToken();
      const authHeader = `Bearer ${token ?? "local-bypass"}`;
      const candRes = await fetch(`${baseUrl}/admin/candidates`, { headers: { Authorization: authHeader } });
      const candData = await candRes.json();
      setCandidates(candData);
      debugLog("lists", "refreshLists:success", { candidates: candData.length });
      console.log(`Refreshed: ${candData.length} candidates`);
    } catch (err) {
      console.error("Failed to refresh lists:", err);
    }
  }, []);

  const logMessage = (msg: string) => {
    setLocalLog(prev => [...prev, msg]);
  };

  useEffect(() => {
    if (state.status === "streaming") {
      const lastMacroMsg = state.log[state.log.length - 1];
      if (lastMacroMsg) {
        setLocalLog(prev => {
          if (prev[prev.length - 1] === lastMacroMsg) return prev;
          return [...prev, lastMacroMsg];
        });
      }
    } else if (state.status === "complete") {
      if (state.log.length > 0) {
        const lastMsg = state.log[state.log.length - 1];
        setLocalLog(prev => (prev[prev.length - 1] === lastMsg ? prev : [...prev, lastMsg]));
      }
    } else if (state.status === "error") {
      if (state.error) logMessage(`ERROR: ${state.error}`);
    }
  }, [state.log, state.status, state.error]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [localLog]);

  useEffect(() => {
    debugLog("lists", "init-effect:fired");
    const init = async () => {
      await refreshLists();
    };
    init();
  }, [refreshLists]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Safety guard to prevent duplicate triggers
    if (state.status === "streaming") {
      logMessage("Research already in progress. Please wait or Stop.");
      return;
    }

    if (url.trim()) {
      setProcessHeading("Generating Listing");
      setLocalLog([]);
      setIsDirty(false);
      setUnsavedSections(new Set());
      setActiveCandidateSlug(null);
      setIsProductLoaded(false);
      startResearch(url.trim());
    }
  };

  // Legacy backend-driven Candidates widget handler -- untouched.
  const handleInject = async () => {
    if (!selectedSlug) return;
    setProcessHeading("Viewing Candidate");
    setLocalLog([]);
    setIsDirty(false);
    setUnsavedSections(new Set());
    setIsProductLoaded(false);
    try {
      const token = await getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/admin/candidates/${selectedSlug}`,
        { headers: { Authorization: `Bearer ${token ?? "local-bypass"}` } }
      );
      const data = await res.json();
      injectListing(data);
      setActiveCandidateSlug(selectedSlug);
      setSelectedSlug("");
    } catch (err) {
      console.error("Failed to fetch candidate data:", err);
    }
  };

  const handleInjectPublished = async () => {
    if (!selectedPublishedSlug) return;
    setProcessHeading("Viewing Published Product");
    setLocalLog([]);
    setIsDirty(false);
    setUnsavedSections(new Set());
    setActiveCandidateSlug(null);
    setIsProductLoaded(true);

    const header = getPublishedProductHeader(selectedPublishedSlug);
    if (!header) {
      logMessage(`ERROR: Could not find Published product data for "${selectedPublishedSlug}".`);
      return;
    }

    const vendorResources = getVendorResourcesForProduct(header.product_name);
    const otherResources = getOtherResourcesForProduct(header.product_name);
    const supportContacts = getSupportContactsForProduct(header.product_name);

    injectListing(
      populateViewerListing(header, vendorResources, otherResources, supportContacts),
      "Injected header, resources, and support from NCADEMI Published Products (AppSheet global table)."
    );
    logMessage(`Loaded header for: ${header.product_name} (${vendorResources.length} vendor resource(s), ${otherResources.length} other resource(s), ${supportContacts.length} support contact(s))`);
  };

  const handleInjectAdded = async () => {
    if (!selectedAddedSlug) return;
    setProcessHeading("Viewing Added Product");
    setLocalLog([]);
    setIsDirty(false);
    setUnsavedSections(new Set());
    setActiveCandidateSlug(null);
    setIsProductLoaded(true);

    const header = getAddedProductHeader(selectedAddedSlug);
    if (!header) {
      logMessage(`ERROR: Could not find Added product data for "${selectedAddedSlug}".`);
      return;
    }

    const vendorResources = getVendorResourcesForProduct(header.product_name);
    const otherResources = getOtherResourcesForProduct(header.product_name);
    const supportContacts = getSupportContactsForProduct(header.product_name);

    injectListing(
      populateViewerListing(header, vendorResources, otherResources, supportContacts),
      "Injected header, resources, and support from NCADEMI Added Products (AppSheet global table)."
    );
    logMessage(`Loaded header for: ${header.product_name} (${vendorResources.length} vendor resource(s), ${otherResources.length} other resource(s), ${supportContacts.length} support contact(s))`);
  };

  const handleInjectCandidateProduct = async () => {
    if (!selectedCandidateProductSlug) return;
    setProcessHeading("Viewing Candidate Product");
    setLocalLog([]);
    setIsDirty(false);
    setUnsavedSections(new Set());
    setActiveCandidateSlug(null);
    setIsProductLoaded(true);

    const header = getCandidateProductHeader(selectedCandidateProductSlug);
    if (!header) {
      logMessage(`ERROR: Could not find Candidate product data for "${selectedCandidateProductSlug}".`);
      return;
    }

    const vendorResources = getVendorResourcesForProduct(header.product_name);
    const otherResources = getOtherResourcesForProduct(header.product_name);
    const supportContacts = getSupportContactsForProduct(header.product_name);

    injectListing(
      populateViewerListing(header, vendorResources, otherResources, supportContacts),
      "Injected header, resources, and support from NCADEMI Candidate Products (AppSheet global table)."
    );
    logMessage(`Loaded header for: ${header.product_name} (${vendorResources.length} vendor resource(s), ${otherResources.length} other resource(s), ${supportContacts.length} support contact(s))`);
  };

  const handleImportProcessed = (result: IngestDraftResponse) => {
    // See nerd-import-data-architecture-v4.md §3.3, §6.
    setProcessHeading("Imported Draft");
    setLocalLog(diagnosticLines(result));
    setIsDirty(false);
    setUnsavedSections(new Set());
    setIsProductLoaded(false);
    setActiveCandidateSlug(null);
    setIsImportOpen(false);
    injectListing({ ...result.parsed_listing, raw_markdown: result.raw_markdown }, "Loaded imported draft.");
  };

  const handleSave = async (target: "candidates" | "products") => {
    if (!state.listing) return;
    const label = target === "candidates" ? "Candidate" : "Product";
    try {
      const token = await getIdToken();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/admin/${target}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? "local-bypass"}` },
        body: JSON.stringify(state.listing),
      });
      if (!res.ok) throw new Error(`Failed to save ${label}`);
      const resData = await res.json();
      if (target === "candidates" && resData.slug) {
        setActiveCandidateSlug(resData.slug);
        setIsProductLoaded(false);
      } else if (target === "products") {
        setActiveCandidateSlug(null);
      }
      setSaveStatus(prev => ({ ...prev, [target]: "Saved!" }));
      logMessage(`Successfully saved to NCADEMI ${label} repository.`);
      setIsDirty(false);
      setUnsavedSections(new Set());
      setTimeout(() => {
        setSaveStatus(prev => ({ ...prev, [target]: "" }));
      }, 3000);
      await refreshLists();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logMessage(`ERROR saving ${label}: ${msg}`);
    }
  };

  const handleUpdateCandidate = async () => {
    if (!state.listing || !activeCandidateSlug) return;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now
        .getFullYear()
        .toString()
        .slice(-2)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const updatedListing = { ...state.listing, last_updated_at: timestamp };
      const token = await getIdToken();
      const res = await fetch(`${baseUrl}/admin/candidates/${activeCandidateSlug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? "local-bypass"}` },
        body: JSON.stringify(updatedListing),
      });
      if (!res.ok) throw new Error("Failed to update candidate");
      updateListing(updatedListing);
      setSaveStatus(prev => ({ ...prev, update: "Updated!" }));
      logMessage(`Candidate listing updated at ${timestamp}.`);
      setIsDirty(false);
      setUnsavedSections(new Set());
      setTimeout(() => {
        setSaveStatus(prev => ({ ...prev, update: "" }));
      }, 3000);
      await refreshLists();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logMessage(`ERROR updating candidate: ${msg}`);
    }
  };

  const handleDeleteCandidate = async () => {
    if (!activeCandidateSlug) {
      logMessage("ERROR: No active candidate slug found for deletion.");
      return;
    }
    if (!confirm(`Are you sure you want to delete the candidate "${activeCandidateSlug}"?`)) {
      return;
    }
    logMessage(`Attempting to delete candidate: ${activeCandidateSlug}...`);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
      const url = `${baseUrl}/admin/candidates/${activeCandidateSlug}`;
      const token = await getIdToken();
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? "local-bypass"}` },
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Failed to delete candidate");
      }
      logMessage(`Successfully deleted candidate from repository.`);
      reset();
      setLocalLog([]);
      setProcessHeading("");
      setActiveCandidateSlug(null);
      setIsProductLoaded(false);
      setEditingSection(null);
      await refreshLists();
      logMessage("UI cleared and dropdowns refreshed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logMessage(`ERROR deleting candidate: ${msg}`);
      console.error("Deletion failure:", err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-900">
          N.E.R.D. | NCADEMI EdTech Researcher for the Directory
        </h1>
      </header>

      <main className="max-w-[90%] mx-auto px-6 py-8 space-y-8">
        <section aria-label="Research input and messages">
          <div className="flex gap-8 items-start">
            <div className="w-1/2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700">Messages</label>
              {state.status === "error" && state.error && (
                <div role="alert" className="bg-red-50 text-red-700 p-3 rounded border border-red-200 text-sm mb-2 font-semibold">
                  {state.error}
                </div>
              )}
              <div
                ref={logRef}
                role="log"
                aria-live="polite"
                aria-atomic="false"
                aria-label="System messages and progress log"
                className="bg-gray-900 text-green-400 font-mono text-xs rounded p-4
                           h-[190px] overflow-y-auto space-y-1 border border-gray-800"
              >
                {processHeading && (
                  <div className="text-white font-bold mb-3 pb-1 border-b border-gray-800 uppercase tracking-wider">
                    {processHeading}
                  </div>
                )}
                {localLog.map((line, i) => {
                  const isLast = i === localLog.length - 1;
                  const isActive = isLast && state.status === "streaming";
                  return (
                    <p key={i}>
                      <span className="text-gray-600 select-none mr-2">›</span>
                      {line}
                      {isActive && <span className="ellipsis-animation"></span>}
                    </p>
                  );
                })}
              </div>
            </div>

            <div className="w-1/2 flex flex-col gap-4">
              {/* Product URL / Generate Listing / Stop -- hidden per current milestone */}
              <div className="hidden">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="product-url" className="text-sm font-semibold text-gray-700">
                      Product URL
                    </label>
                    <div className="flex gap-3">
                      <input
                        id="product-url"
                        type="url"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://vendor.com/product"
                        required
                        disabled={state.status === "streaming"}
                        className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500
                                   disabled:bg-gray-100 disabled:cursor-not-allowed"
                      />
                      <button
                        type="submit"
                        disabled={!url.trim() || state.status === "streaming"}
                        className="w-44 bg-blue-700 text-white text-sm font-medium px-5 py-2
                                   rounded hover:bg-blue-800 focus:outline-none
                                   focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                                   disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                      >
                        {state.status === "streaming" ? "Processing..." : "Generate Listing"}
                      </button>
                      <button
                        type="button"
                        onClick={stopResearch}
                        disabled={state.status !== "streaming"}
                        aria-disabled={state.status !== "streaming"}
                        className="bg-[#bf1712] text-white text-sm font-medium px-5 py-2 rounded
                                   hover:bg-red-800 focus:outline-none focus:ring-2
                                   focus:ring-red-500 focus:ring-offset-2
                                   disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* NCADEMI Published Products -- header wired to AppSheet global table */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">NCADEMI Published Products</label>
                <div className="flex gap-3 items-center">
                <select
                    aria-label="Select NCADEMI Published Product"
                    value={selectedPublishedSlug}
                    onChange={e => {
                      clearAllProductSelections();
                      setSelectedPublishedSlug(e.target.value);
                    }}
                    disabled={state.status === "streaming"}
                    className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               bg-white text-gray-700 disabled:bg-gray-100
                               disabled:cursor-not-allowed"
                  >
                    <option value="">select Published Product</option>
                    {publishedProducts.map(p => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInjectPublished}
                    disabled={!selectedPublishedSlug || state.status === "streaming"}
                    className="w-44 bg-[#333] text-white text-sm font-medium px-6 py-2 rounded
                               hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all
                               whitespace-nowrap"
                  >
                    View Published
                  </button>
                </div>
              </div>

              {/* NCADEMI Added Products -- header wired to AppSheet global table */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">NCADEMI Added Products</label>
                <div className="flex gap-3 items-center">
                  <select
                    aria-label="Select NCADEMI Added Product"
                    value={selectedAddedSlug}
                    onChange={e => {
                      clearAllProductSelections();
                      setSelectedAddedSlug(e.target.value);
                    }}
                    disabled={state.status === "streaming"}
                    className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               bg-white text-gray-700 disabled:bg-gray-100
                               disabled:cursor-not-allowed"
                  >
                    <option value="">select Added Product</option>
                    {addedProducts.map(p => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInjectAdded}
                    disabled={!selectedAddedSlug || state.status === "streaming"}
                    className="w-44 bg-[#333] text-white text-sm font-medium px-6 py-2 rounded
                               hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all
                               whitespace-nowrap"
                  >
                    View Added
                  </button>
                </div>
              </div>

              {/* NCADEMI Candidate Products -- new, header wired to AppSheet global table.
                  Eventually will write data back into appsheet-tables.json -- read-only for now. */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">NCADEMI Candidate Products</label>
                <div className="flex gap-3 items-center">
                              <select
                    aria-label="Select NCADEMI Candidate Products"
                    value={selectedCandidateProductSlug}
                    onChange={e => {
                      clearAllProductSelections();
                      setSelectedCandidateProductSlug(e.target.value);
                    }}
                    disabled={state.status === "streaming"}
                    className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               bg-white text-gray-700 disabled:bg-gray-100
                               disabled:cursor-not-allowed"
                  >
                    <option value="">select Candidate Products</option>
                    {candidateProducts.map(p => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInjectCandidateProduct}
                    disabled={!selectedCandidateProductSlug || state.status === "streaming"}
                    className="w-44 bg-[#333] text-white text-sm font-medium px-6 py-2 rounded
                               hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all
                               whitespace-nowrap"
                  >
                    View Candidate
                  </button>
                </div>
              </div>

              {/* NCADEMI Candidates (legacy) -- unchanged backend-driven workflow,
                  relabeled per product decision. */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">NCADEMI Candidates (legacy)</label>
                <div className="flex gap-3 items-center">
                   <select
                    aria-label="Select Candidate"
                    value={selectedSlug}
                    onChange={e => {
                      clearAllProductSelections();
                      setSelectedSlug(e.target.value);
                    }}
                    disabled={state.status === "streaming"}
                    className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               bg-white text-gray-700 disabled:bg-gray-100
                               disabled:cursor-not-allowed"
                  >
                    <option value="">select Candidate</option>
                    {candidates.map(c => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInject}
                    disabled={!selectedSlug || state.status === "streaming"}
                    className="w-44 bg-[#333] text-white text-sm font-medium px-6 py-2 rounded
                               hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all
                               whitespace-nowrap"
                  >
                    View Candidate
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsImportOpen(true)}
                    disabled={state.status === "streaming"}
                    className="bg-blue-700 text-white text-sm font-medium px-5 py-2 rounded
                               hover:bg-blue-800 focus:outline-none focus:ring-2
                               focus:ring-blue-500 focus:ring-offset-2
                               disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  >
                    Import
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {state.status === "complete" && state.listing && (
          <>
            <div className="flex gap-3 items-center" role="toolbar" aria-label="Listing actions">
              <button
                onClick={async () => {
                  try {
                    const token = await getIdToken();
                    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/render`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? "local-bypass"}` },
                      body: JSON.stringify(state.listing),
                    });
                    if (!res.ok) throw new Error("Failed to copy HTML");
                    const d = await res.json();
                    await navigator.clipboard.writeText(d.html);
                  } catch (err) {
                    console.error("Copy HTML failed", err);
                  }
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Copy HTML
              </button>
              <button
                onClick={async () => {
                  try {
                    const token = await getIdToken();
                    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/render`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? "local-bypass"}` },
                      body: JSON.stringify(state.listing),
                    });
                    if (!res.ok) throw new Error("Failed to download HTML");
                    const d = await res.json();
                    const blob = new Blob([d.html], { type: "text/html" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `${state.listing?.product_name ?? "listing"}.html`;
                    a.click();
                  } catch (err) {
                    console.error("Download HTML failed", err);
                  }
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Download HTML
              </button>
              <button
                onClick={() => {
                  reset();
                  setLocalLog([]);
                  setProcessHeading("");
                  setIsDirty(false);
                  setActiveCandidateSlug(null);
                  setIsProductLoaded(false);
                  setEditingSection(null);
                  setUnsavedSections(new Set());
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Clear
              </button>

              {!isProductLoaded && (
                <div aria-label="Section editors" className="ml-auto flex items-center gap-2 border-l pl-3">
                  <span className="text-xs font-semibold text-gray-600">EDIT:</span>
                  {SECTION_KEYS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setEditingSection(key);
                        setEditorOpenCount(c => c + 1);
                      }}
                      className="relative text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50"
                    >
                      {label}
                      {unsavedSections.has(key) && (
                        <span
                          className="absolute -top-1 -right-1 block h-2 w-2 rounded-full bg-blue-500"
                          title="This section has unsaved changes"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <section aria-label="Research results">
              <div className="relative bg-white border border-gray-200 rounded-lg p-6">
                <div className="absolute top-4 right-4 flex gap-2">
                  {!activeCandidateSlug && !isProductLoaded && (
                    <button
                      onClick={() => handleSave("candidates")}
                      className="inline-flex items-center gap-1.5 text-xs text-black
                                 border border-black rounded px-2.5 py-1.5
                                 hover:bg-gray-50 focus:outline-none focus:ring-2
                                 focus:ring-gray-500 focus:ring-offset-2 transition-all"
                    >
                      <span aria-live="polite">{saveStatus["candidates"] || "Save Candidate"}</span>
                    </button>
                  )}
                  {activeCandidateSlug && (
                    <button
                      onClick={handleUpdateCandidate}
                      disabled={!isDirty}
                      className="inline-flex items-center gap-1.5 text-xs text-black
                                 border border-black rounded px-2.5 py-1.5
                                 hover:bg-gray-50 focus:outline-none focus:ring-2
                                 focus:ring-gray-500 focus:ring-offset-2 transition-all
                                 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <span aria-live="polite">{saveStatus["update"] || "Update Candidate"}</span>
                    </button>
                  )}

                  {activeCandidateSlug && (
                    <button
                      onClick={handleDeleteCandidate}
                      className="inline-flex items-center gap-1.5 text-xs text-red-600
                                 border border-red-600 rounded px-2.5 py-1.5
                                 hover:bg-red-50 focus:outline-none focus:ring-2
                                 focus:ring-red-500 focus:ring-offset-2 transition-all"
                    >
                      Delete Candidate
                    </button>
                  )}
                </div>

                <ListingCard listing={state.listing} />
              </div>
            </section>
          </>
        )}
      </main>

      {editingSection && state.listing && (
        <SectionEditor
          key={`${editingSection}-${editorOpenCount}`}
          sectionKey={editingSection}
          label={SECTION_KEYS.find(k => k.key === editingSection)?.label || "Section"}
          initialHtml={getSectionHtml(state.listing, editingSection)}
          isOverridden={state.listing.section_overrides?.[editingSection] != null}
          generatedHtml={""}
          isOpen={!!editingSection}
          onSave={handleSaveSection}
          onReset={handleResetSection}
          onClose={() => setEditingSection(null)}
        />
      )}

      {isImportOpen && (
        <ImportDataModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          onProcessed={handleImportProcessed}
        />
      )}
    </div>
  );
}