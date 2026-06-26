"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useResearch } from "@/hooks/useResearch";
import { ListingCard } from "@/components/ListingCard";
import { InvalidLinksModal } from "@/components/InvalidLinksModal";
import { InvalidLink, SectionKey } from "@/lib/types";
import { SectionEditor } from "@/components/SectionEditor";
import { getSectionHtml } from "@/lib/ncademiPreview";
import { getIdToken } from "@/lib/firebase";

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

export default function Home() {
  const { state, startResearch, reset, updateListing, injectListing } = useResearch();
  const [url, setUrl] = useState("");
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [invalidLinks, setInvalidLinks] = useState<InvalidLink[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRef[]>([]);
  const [products, setProducts] = useState<{ name: string; slug: string }[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [selectedProductSlug, setSelectedProductSlug] = useState("");
  const [activeCandidateSlug, setActiveCandidateSlug] = useState<string | null>(null);
  const [isProductLoaded, setIsProductLoaded] = useState(false);
  const [processHeading, setProcessHeading] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ [key: string]: string }>({});
  const [isDirty, setIsDirty] = useState(false);
  const [localLog, setLocalLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const heartbeatTimer = useRef<NodeJS.Timeout | null>(null);

  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [editorOpenCount, setEditorOpenCount] = useState(0);

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
  };

  const refreshLists = useCallback(async () => {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
    try {
      const token = await getIdToken();
      const authHeader = `Bearer ${token ?? "local-bypass"}`;
      const [candRes, prodRes] = await Promise.all([
        fetch(`${baseUrl}/admin/candidates`, { headers: { Authorization: authHeader } }),
        fetch(`${baseUrl}/admin/products`, { headers: { Authorization: authHeader } }),
      ]);
      const [candData, prodData] = await Promise.all([candRes.json(), prodRes.json()]);
      setCandidates(candData);
      setProducts(prodData);
      console.log(`Refreshed: ${candData.length} candidates, ${prodData.length} products`);
    } catch (err) {
      console.error("Failed to refresh lists:", err);
    }
  }, []);

  const MICRO_MESSAGES = {
    searching: [
      "Initializing web crawler...",
      "Analyzing robots.txt for compliance...",
      "Traversing DOM tree...",
      "Extracting meta tags and JSON-LD...",
      "Following canonical redirects...",
      "Filtering non-relevant scripts...",
      "Snapshotting page content for parsing...",
      "Resolving vendor directory paths...",
      "Analyzing accessibility landmarks...",
      "Scoping vendor support resources...",
    ],
    validating: [
      "Checking SSL certificate validity...",
      "Verifying server response headers...",
      "Detecting soft-404 redirects...",
      "Checking for broken anchor tags...",
      "Validating CORS headers...",
      "Testing link aria-labels...",
      "Timing out slow responses...",
      "Validating resource patterns...",
      "Fetching remote screenshot...",
      "Verifying content-type headers...",
    ],
    synthesizing: [
      "Assembling research fragments...",
      "Applying NCADEMI architectural constraints...",
      "Deduplicating resource URLs...",
      "Normalizing product description prose...",
      "Synthesizing AI-generated insights...",
      "Mapping ACR reports to standard schema...",
      "Validating final JSON structure...",
      "Formatting WordPress-ready fragments...",
      "Calculating data fidelity metrics...",
      "Finalizing research draft...",
    ],
  };

  const heartbeatType = useRef<keyof typeof MICRO_MESSAGES | null>(null);

  const logMessage = (msg: string) => {
    setLocalLog(prev => [...prev, msg]);
  };

  const startHeartbeat = (type: keyof typeof MICRO_MESSAGES) => {
    if (heartbeatType.current === type) return;
    stopHeartbeat();
    heartbeatType.current = type;
    let index = 0;
    heartbeatTimer.current = setInterval(() => {
      const msg = MICRO_MESSAGES[type][index % MICRO_MESSAGES[type].length];
      logMessage(msg);
      index++;
    }, 1000);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
    heartbeatType.current = null;
  };

  useEffect(() => {
    if (state.status === "streaming") {
      const lastMacroMsg = state.log[state.log.length - 1];
      if (lastMacroMsg) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocalLog(prev => {
          if (prev[prev.length - 1] === lastMacroMsg) return prev;
          return [...prev, lastMacroMsg];
        });
      }
      const msgLower = lastMacroMsg?.toLowerCase() || "";
      if (
        msgLower.includes("queuing") ||
        msgLower.includes("opening") ||
        msgLower.includes("researching") ||
        msgLower.includes("analyzing")
      ) {
        startHeartbeat("searching");
      } else if (msgLower.includes("synthesizing") || msgLower.includes("insights")) {
        startHeartbeat("synthesizing");
      }
    } else if (state.status === "complete") {
      stopHeartbeat();
      if (state.log.length > 0) {
        const lastMsg = state.log[state.log.length - 1];
        setLocalLog(prev => (prev[prev.length - 1] === lastMsg ? prev : [...prev, lastMsg]));
      }
    } else if (state.status === "error") {
      stopHeartbeat();
      if (state.error) logMessage(`ERROR: ${state.error}`);
    } else if (state.status === "idle") {
      stopHeartbeat();
    }
  }, [state.log, state.status, state.error]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [localLog]);

  useEffect(() => {
    return () => stopHeartbeat();
  }, []);

  useEffect(() => {
    const init = async () => {
      await refreshLists();
    };
    init();
  }, [refreshLists]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      setProcessHeading("Generating Listing");
      setLocalLog([]);
      setIsDirty(false);
      setActiveCandidateSlug(null);
      setIsProductLoaded(false);
      startResearch(url.trim());
    }
  };

  const handleInject = async () => {
    if (!selectedSlug) return;
    setProcessHeading("Viewing Candidate");
    setLocalLog([]);
    setIsDirty(false);
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
      console.log(`Active candidate slug set to: ${selectedSlug}`);
      setSelectedSlug("");
    } catch (err) {
      console.error("Failed to fetch candidate data:", err);
    }
  };

  const handleInjectProduct = async () => {
    if (!selectedProductSlug) return;
    setProcessHeading("Viewing Product");
    setLocalLog([]);
    setIsDirty(false);
    try {
      const token = await getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/admin/products/${selectedProductSlug}`,
        { headers: { Authorization: `Bearer ${token ?? "local-bypass"}` } }
      );
      const data = await res.json();
      injectListing(data, "Injected data from saved product.");
      setActiveCandidateSlug(null);
      setIsProductLoaded(true);
      setSelectedProductSlug("");
    } catch (err) {
      console.error("Failed to fetch product data:", err);
    }
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
        console.log(`Active candidate slug updated to: ${resData.slug}`);
      } else if (target === "products") {
        setActiveCandidateSlug(null);
      }
      setSaveStatus(prev => ({ ...prev, [target]: "Saved!" }));
      logMessage(`Successfully saved to NCADEMI ${label} repository.`);
      setIsDirty(false);
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

  const handleValidateLinks = async () => {
    if (!state.listing) return;
    setIsValidating(true);
    logMessage("--- Link Validation Started ---");
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
      const candidateUrls = candidateLinks
        .map(link => link.url)
        .filter(url => url && url !== "#" && url.startsWith("http"));
      if (candidateUrls.length === 0) {
        logMessage("No valid candidate URLs found for validation.");
        setIsValidating(false);
        return;
      }
      logMessage(`Validating ${candidateUrls.length} unique URLs...`);
      startHeartbeat("validating");
      const token = await getIdToken();
      const authHeader = `Bearer ${token ?? "local-bypass"}`;
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/research/validate-links-async`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({ urls: candidateUrls }),
        }
      );
      if (!response.ok) {
        throw new Error(`Validation service failed with status: ${response.status}`);
      }
      const { job_id } = await response.json();
      logMessage(`Job queued: ${job_id}. Polling for results...`);
      let results = null;
      let iterations = 0;
      const MAX_POLLS = 90;
      while (iterations < MAX_POLLS) {
        iterations++;
        const statusRes = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/research/validate-links/${job_id}`,
          {
            headers: { Authorization: authHeader },
          }
        );
        if (!statusRes.ok) {
          const detail =
            statusRes.status === 404
              ? "Validation job not found (may have been lost to an instance restart)"
              : `Server error (${statusRes.status})`;
          throw new Error(detail);
        }
        const statusData = await statusRes.json();
        if (statusData.status === "complete") {
          results = statusData.results;
          logMessage("Validation backend processing complete.");
          stopHeartbeat();
          break;
        } else if (statusData.status === "error") {
          throw new Error(statusData.error || "Validation job failed");
        }
        if (iterations % 4 === 0) {
          logMessage(`Polling validation status (Attempt ${iterations}/${MAX_POLLS})...`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (!results) {
        throw new Error("Validation timed out after 3 minutes. Partial results may be available — please retry.");
      }
      const brokenLinksToDisplay = candidateLinks
        .map(link => {
          const res = results[link.url];
          if (res && !res.is_valid) {
            return {
              ...link,
              reason: res.reason,
              screenshot_path: res.screenshot_path
                ? `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}${res.screenshot_path}`
                : undefined,
            } as InvalidLink;
          }
          return null;
        })
        .filter((l): l is InvalidLink => l !== null);
      logMessage(`Validation complete. Found ${brokenLinksToDisplay.length} broken links.`);
      setInvalidLinks(brokenLinksToDisplay);
      setShowValidationModal(true);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      logMessage(`ERROR during validation: ${msg}`);
      console.error("Link validation encountered an error:", error);
    } finally {
      setIsValidating(false);
    }
  };

  const handleApplyChanges = (toDelete: InvalidLink[], toAdd: { section: string; text: string; url: string }[]) => {
    if (!state.listing) return;
    const toDeleteUrls = new Set(toDelete.map(l => l.url));
    const updated = {
      ...state.listing,
      vendor_resources: state.listing.vendor_resources.filter(r => !toDeleteUrls.has(r.url)),
      other_resources: state.listing.other_resources.filter(r => !toDeleteUrls.has(r.url)),
      support_contacts: state.listing.support_contacts.filter(c => !toDeleteUrls.has(c.value)),
      acr_reports: state.listing.acr_reports.filter(a => !toDeleteUrls.has(a.url)),
    };
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
    logMessage(`Validation applied: ${toDelete.length} link(s) removed, ${toAdd.length} link(s) added.`);
    setTimeout(() => {
      setIsDirty(true);
      logMessage("Ready to update candidate repository.");
    }, 100);
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
                  const isActive = isLast && (state.status === "streaming" || isValidating);
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
                      disabled={state.status === "streaming" || isValidating}
                      className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-blue-500
                                 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                    <button
                      type="submit"
                      disabled={!url.trim() || state.status === "streaming" || isValidating}
                      className="w-44 bg-blue-700 text-white text-sm font-medium px-5 py-2
                                 rounded hover:bg-blue-800 focus:outline-none
                                 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                                 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                    >
                      {state.status === "streaming" ? "Processing..." : "Generate Listing"}
                    </button>
                  </div>
                </div>
              </form>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">NCADEMI Products</label>
                <div className="flex gap-3 items-center">
                  <select
                    aria-label="Select NCADEMI Product"
                    value={selectedProductSlug}
                    onChange={e => setSelectedProductSlug(e.target.value)}
                    disabled={state.status === "streaming" || isValidating}
                    className="w-[55%] border border-gray-300 rounded px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               bg-white text-gray-700 disabled:bg-gray-100 
                               disabled:cursor-not-allowed"
                  >
                    <option value="">select Product</option>
                    {products.map(p => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInjectProduct}
                    disabled={!selectedProductSlug || state.status === "streaming" || isValidating}
                    className="w-44 bg-[#333] text-white text-sm font-medium px-6 py-2 rounded
                               hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all
                               whitespace-nowrap"
                  >
                    View Product
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700">NCADEMI Candidate</label>
                <div className="flex gap-3 items-center">
                  <select
                    aria-label="Select NCADEMI Candidate"
                    value={selectedSlug}
                    onChange={e => setSelectedSlug(e.target.value)}
                    disabled={state.status === "streaming" || isValidating}
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
                    disabled={!selectedSlug || state.status === "streaming" || isValidating}
                    className="w-44 bg-[#333] text-white text-sm font-medium px-6 py-2 rounded
                               hover:bg-black focus:outline-none focus:ring-2 focus:ring-gray-500
                               disabled:opacity-30 disabled:cursor-not-allowed transition-all
                               whitespace-nowrap"
                  >
                    View Candidate
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/admin/batch-report`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                      title="View Full Batch Report"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-5 h-5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                        />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {state.status === "complete" && state.listing && (
          <>
            <div className="flex gap-3 items-center" role="toolbar" aria-label="Listing actions">
              <button
                onClick={() => {
                  fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/render`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(state.listing),
                  })
                    .then(r => r.json())
                    .then(d => navigator.clipboard.writeText(d.html));
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Copy HTML
              </button>
              <button
                onClick={() => {
                  fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/render`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(state.listing),
                  })
                    .then(r => r.json())
                    .then(d => {
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
                onClick={() => {
                  reset();
                  setLocalLog([]);
                  setProcessHeading("");
                  setIsDirty(false);
                  setActiveCandidateSlug(null);
                  setIsProductLoaded(false);
                  setEditingSection(null);
                }}
                className="border border-gray-300 text-sm px-4 py-2 rounded
                           hover:bg-gray-50 focus:outline-none focus:ring-2
                           focus:ring-blue-500 focus:ring-offset-2"
              >
                Clear
              </button>

              {!isProductLoaded && (
                <div role="toolbar" aria-label="Section editors" className="ml-auto flex items-center gap-2 border-l pl-3">
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
                      {state.listing?.section_overrides?.[key] != null && (
                        <span
                          className="absolute -top-1 -right-1 block h-2 w-2 rounded-full bg-blue-500"
                          title="This section has been manually overridden"
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
                  {!activeCandidateSlug ? (
                    <button
                      onClick={() => handleSave("candidates")}
                      className="inline-flex items-center gap-1.5 text-xs text-black
                                 border border-black rounded px-2.5 py-1.5
                                 hover:bg-gray-50 focus:outline-none focus:ring-2
                                 focus:ring-gray-500 focus:ring-offset-2 transition-all"
                    >
                      <span aria-live="assertive">{saveStatus["candidates"] || "Save Candidate"}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleUpdateCandidate}
                      disabled={!isDirty || isValidating}
                      className="inline-flex items-center gap-1.5 text-xs text-black
                                 border border-black rounded px-2.5 py-1.5
                                 hover:bg-gray-50 focus:outline-none focus:ring-2
                                 focus:ring-gray-500 focus:ring-offset-2 transition-all
                                 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <span aria-live="assertive">{saveStatus["update"] || "Update Candidate"}</span>
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

      {showValidationModal && (
        <InvalidLinksModal
          links={invalidLinks}
          vendorName={state.listing?.vendor_name || ""}
          onClose={() => setShowValidationModal(false)}
          onApplyChanges={handleApplyChanges}
          readOnly={isProductLoaded}
        />
      )}

      {editingSection && state.listing && (
        <SectionEditor
          key={`${editingSection}-${editorOpenCount}`}
          sectionKey={editingSection}
          label={SECTION_KEYS.find(k => k.key === editingSection)?.label || "Section"}
          initialHtml={getSectionHtml(state.listing, editingSection)}
          isOverridden={state.listing.section_overrides?.[editingSection] != null}
          generatedHtml={""} // This prop is for conceptual completeness. Reset logic is handled by the parent.
          isOpen={!!editingSection}
          onSave={handleSaveSection}
          onReset={handleResetSection}
          onClose={() => setEditingSection(null)}
        />
      )}
    </div>
  );
}
