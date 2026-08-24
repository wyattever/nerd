// frontend/app/vendors/page.tsx
"use client";

/**
 * Visual editor for the global vendors registry (frontend/lib/vendors.json),
 * modeled on /editor (app/editor/page.tsx) but considerably simpler: there
 * is exactly one document here, not three parallel candidate/added/published
 * arrays, so there is no activeTab, no ENDPOINT_FOR_TAB lookup, and
 * setActiveProducts's per-tab routing has no equivalent -- `vendors` is
 * just a flat array with a single setter.
 *
 * Fetched client-side from /api/local/vendors on mount, same as /editor's
 * three documents -- this page has no Server Component data loader either,
 * so "fresh from disk" is the only read path.
 *
 * The EDIT: fieldset's four buttons (Header, Global Resources, Product/s,
 * Support) are stubs for this dispatch -- no structured field editors exist
 * yet for VendorRecord, unlike PublishedProductRecord's five. "Save vendor"
 * and "Delete vendor" are real: both go through saveToServer, which is
 * /editor's handleSaveToServer narrowed to one document instead of one of
 * three -- same ETag/If-Match/412 handling, same recordsToSave override so
 * handleDeleteVendor can pass the freshly filtered array directly rather
 * than relying on `vendors` state, which would still hold the pre-delete
 * array until React's async update lands (see /editor's header comment on
 * handleDeleteConfirm for the full reasoning).
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { VendorSidebar } from "@/components/VendorSidebar";
import { VendorPreview } from "@/components/VendorPreview";
import type { VendorRecord, VendorsFile } from "@/lib/vendor-schema";

type LoadState = "loading" | "ready" | "unavailable";

interface VendorFileMeta {
  schemaVersion: number | null;
  meta: VendorsFile["$meta"] | null;
  etag: string | null;
}

const EMPTY_FILE_META: VendorFileMeta = { schemaVersion: null, meta: null, etag: null };
const VENDORS_ENDPOINT = "/api/local/vendors";

export default function VendorsPage() {
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [fileMeta, setFileMeta] = useState<VendorFileMeta>(EMPTY_FILE_META);
  const [selectedName, setSelectedName] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [statusMessage, setStatusMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  // Fresh fetch on mount -- see file header.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(VENDORS_ENDPOINT);
        if (!res.ok) throw new Error(`GET ${VENDORS_ENDPOINT} failed with ${res.status}`);
        const etag = res.headers.get("ETag");
        const body = (await res.json()) as VendorsFile;
        if (cancelled) return;

        const loadedVendors = Array.isArray(body.vendors) ? body.vendors : [];
        setVendors(loadedVendors);
        setFileMeta({
          schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
          meta: body.$meta ?? null,
          etag,
        });

        if (loadedVendors.length > 0) {
          setSelectedName(loadedVendors[0].vendor_name);
          setLoadState("ready");
          setStatusMessage(`Loaded ${loadedVendors.length} vendor records from disk.`);
        } else {
          setLoadState("unavailable");
          setStatusMessage("The vendors registry contains no vendors.");
        }
      } catch {
        if (cancelled) return;
        setLoadState("unavailable");
        setStatusMessage(
          "Could not load vendors.json from the local write API. This page only works in local development."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => vendors.find((v) => v.vendor_name === selectedName) ?? null,
    [vendors, selectedName]
  );

  // Persists the vendors array to disk via /api/local/vendors. Mirrors
  // /editor's handleSaveToServer -- see the file header for how this
  // narrows to a single document.
  const saveToServer = useCallback(
    (recordsToSave?: VendorRecord[]) => {
      const vendorsToSave = recordsToSave ?? vendors;

      if (!fileMeta.etag) {
        setSaveError(
          "Cannot save: no ETag from the server for the vendors list. The local write API may be unavailable, or vendors.json does not exist yet (this feature only works in local development)."
        );
        return;
      }
      if (fileMeta.schemaVersion === null || fileMeta.meta === null) {
        setSaveError("Cannot save: vendors snapshot metadata was not loaded.");
        return;
      }

      setSaveError("");
      setStatusMessage("Saving…");

      const file: VendorsFile = {
        $schema_version: fileMeta.schemaVersion,
        $meta: fileMeta.meta,
        vendors: vendorsToSave,
      };
      const ifMatch = fileMeta.etag;

      startSaveTransition(async () => {
        try {
          const res = await fetch(VENDORS_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", "If-Match": ifMatch },
            body: JSON.stringify(file),
          });

          if (res.status === 412) {
            setStatusMessage("");
            setSaveError(
              "Save failed: the file on disk changed since this copy was loaded. Reload the page and re-apply your edits."
            );
            return;
          }

          if (res.status === 400) {
            const errorBody = await res.json().catch(() => null);
            setStatusMessage("");
            setSaveError(`Save failed: ${errorBody?.error ?? "the server rejected this data."}`);
            return;
          }

          if (!res.ok) {
            setStatusMessage("");
            setSaveError(`Save failed: unexpected server response (${res.status}).`);
            return;
          }

          const result = (await res.json()) as { etag?: string };
          const newEtag = res.headers.get("ETag") ?? result.etag ?? null;
          setFileMeta((prev) => ({ ...prev, etag: newEtag }));
          setVendors(vendorsToSave);
          setSaveError("");
          setStatusMessage(`Saved ${vendorsToSave.length} vendor records to disk.`);
        } catch {
          setStatusMessage("");
          setSaveError("Save failed: could not reach the local write API.");
        }
      });
    },
    [fileMeta, vendors]
  );

  // Filters the selected vendor out, resets the selection, and saves the
  // filtered array directly -- see the file header on why saveToServer
  // takes the array explicitly rather than reading it back from `vendors`.
  const handleDeleteVendor = useCallback(() => {
    if (!selected) return;
    if (!window.confirm(`Permanently delete "${selected.vendor_name}"? This cannot be undone.`)) return;
    const newArray = vendors.filter((v) => v.vendor_name !== selected.vendor_name);
    setVendors(newArray);
    setSelectedName(newArray[0]?.vendor_name ?? "");
    saveToServer(newArray);
  }, [selected, vendors, saveToServer]);

  return (
    <div className="flex min-h-full">
      <VendorSidebar vendors={vendors} selectedName={selectedName} onSelectName={setSelectedName} />

      <div className="flex min-w-[1200px] flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-gray-900">Vendors Editor</h1>

          {/* Polite region: load status, "Saving…" / "Saved" -- rendered
              unconditionally so it exists in the DOM before it is populated. */}
          <p role="status" aria-live="polite" className="text-sm text-gray-600">
            {statusMessage}
          </p>
        </header>

        {/* Separate assertive region for save failures (412 / 400 / network),
            so a save error interrupts rather than waiting behind polite
            announcements. Also rendered unconditionally, populated later. */}
        <p role="alert" className="text-sm font-semibold text-red-700">
          {saveError}
        </p>

        <div className="flex items-center justify-between pb-4">
          <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0">
            <legend className="mb-2.5 text-sm font-bold text-gray-500">EDIT:</legend>

            <button
              type="button"
              onClick={() => alert("Stubbed")}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Header
            </button>

            <button
              type="button"
              onClick={() => alert("Stubbed")}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Global Resources
            </button>

            <button
              type="button"
              onClick={() => alert("Stubbed")}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Product/s
            </button>

            <button
              type="button"
              onClick={() => alert("Stubbed")}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Support
            </button>
          </fieldset>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => saveToServer()}
              disabled={isSaving}
              className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {isSaving ? "Saving…" : "Save vendor"}
            </button>

            <button
              type="button"
              onClick={handleDeleteVendor}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Delete vendor
            </button>
          </div>
        </div>

        <section aria-label="Vendor preview" className="rounded border border-gray-200 bg-gray-50 p-4">
          {loadState === "loading" ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : loadState === "unavailable" ? (
            <p className="text-sm text-gray-500">No preview available.</p>
          ) : selected ? (
            <VendorPreview vendor={selected} />
          ) : (
            <p className="text-sm text-gray-500">Select a vendor to preview it.</p>
          )}
        </section>
      </div>
    </div>
  );
}
