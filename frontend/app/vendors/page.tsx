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
 * Support) open dedicated Vendor*Editor.tsx dialogs (VendorHeaderEditor,
 * VendorGlobalResourcesEditor, VendorProductsEditor, VendorSupportEditor),
 * one per VendorRecord field group -- mirroring /editor's five
 * Published*Editor dialogs (open state + button ref + onSave/onClose
 * handler per editor) but writing into the single flat `vendors` array
 * instead of routing through setActiveProducts. "Save vendor" and "Delete
 * vendor" are real: both go through saveToServer, which is
 * /editor's handleSaveToServer narrowed to one document instead of one of
 * three -- same ETag/If-Match/412 handling, same recordsToSave override so
 * handleDeleteVendor can pass the freshly filtered array directly rather
 * than relying on `vendors` state, which would still hold the pre-delete
 * array until React's async update lands (see /editor's header comment on
 * handleDeleteConfirm for the full reasoning).
 *
 * "Add Vendor" (styled like /editor's "Import Candidate" primary button,
 * always enabled unlike the four edit buttons) opens VendorCreateModal,
 * which authors a brand-new VendorRecord from scratch rather than editing
 * `selected`. Its onAdd handler (handleAddVendor) appends to `vendors` and
 * selects the new record by name -- same local-state-only, "not yet saved
 * to disk" pattern as the field editors, not a new persistence path.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { VendorSidebar } from "@/components/VendorSidebar";
import { VendorPreview } from "@/components/VendorPreview";
import { VendorHeaderEditor, type VendorHeaderFields } from "@/components/VendorHeaderEditor";
import { VendorGlobalResourcesEditor } from "@/components/VendorGlobalResourcesEditor";
import { VendorProductsEditor } from "@/components/VendorProductsEditor";
import { VendorSupportEditor } from "@/components/VendorSupportEditor";
import { VendorCreateModal } from "@/components/VendorCreateModal";
import type { PublishedSupportContact } from "@/lib/published-tables";
import type { VendorProductLink, VendorRecord, VendorResource, VendorsFile } from "@/lib/vendor-schema";

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

  // Field-editor dialog state, mirroring /editor's isHeaderEditorOpen etc.
  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState(false);
  const [isGlobalResourcesEditorOpen, setIsGlobalResourcesEditorOpen] = useState(false);
  const [isProductsEditorOpen, setIsProductsEditorOpen] = useState(false);
  const [isSupportEditorOpen, setIsSupportEditorOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const editHeaderButtonRef = useRef<HTMLButtonElement>(null);
  const editGlobalResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editProductsButtonRef = useRef<HTMLButtonElement>(null);
  const editSupportButtonRef = useRef<HTMLButtonElement>(null);
  const addVendorButtonRef = useRef<HTMLButtonElement>(null);

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

  // Local-state-only update, mirroring /editor's handleHeaderSave. Also
  // re-points selectedName at the (possibly new) vendor_name -- unlike
  // /editor's slug, vendor_name IS the join key `selected` is looked up by
  // (see vendor-schema.ts), so a rename here would otherwise orphan the
  // current selection.
  const handleHeaderSave = useCallback(
    (fields: VendorHeaderFields) => {
      setVendors((prev) => prev.map((v) => (v.vendor_name === selectedName ? { ...v, ...fields } : v)));
      setSelectedName(fields.vendor_name);
      setStatusMessage(`Updated header for ${fields.vendor_name} (not yet saved to disk).`);
    },
    [selectedName]
  );

  const handleHeaderEditorClosed = useCallback(() => {
    setIsHeaderEditorOpen(false);
    editHeaderButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleHeaderSave.
  const handleGlobalResourcesSave = useCallback(
    (resources: VendorResource[]) => {
      setVendors((prev) => prev.map((v) => (v.vendor_name === selectedName ? { ...v, resources } : v)));
      setStatusMessage(
        `Updated global resources (${resources.length}) for ${selectedName || "this vendor"} (not yet saved to disk).`
      );
    },
    [selectedName]
  );

  const handleGlobalResourcesEditorClosed = useCallback(() => {
    setIsGlobalResourcesEditorOpen(false);
    editGlobalResourcesButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleHeaderSave.
  const handleProductsSave = useCallback(
    (products: VendorProductLink[]) => {
      setVendors((prev) => prev.map((v) => (v.vendor_name === selectedName ? { ...v, products } : v)));
      setStatusMessage(
        `Updated products (${products.length}) for ${selectedName || "this vendor"} (not yet saved to disk).`
      );
    },
    [selectedName]
  );

  const handleProductsEditorClosed = useCallback(() => {
    setIsProductsEditorOpen(false);
    editProductsButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleHeaderSave.
  const handleSupportSave = useCallback(
    (contacts: PublishedSupportContact[]) => {
      setVendors((prev) =>
        prev.map((v) => (v.vendor_name === selectedName ? { ...v, support_contacts: contacts } : v))
      );
      setStatusMessage(
        `Updated support contacts (${contacts.length}) for ${selectedName || "this vendor"} (not yet saved to disk).`
      );
    },
    [selectedName]
  );

  const handleSupportEditorClosed = useCallback(() => {
    setIsSupportEditorOpen(false);
    editSupportButtonRef.current?.focus();
  }, []);

  // Injects a freshly authored VendorRecord (from VendorCreateModal) into
  // local state and selects it, so the viewer displays it immediately --
  // same "not yet saved to disk" local-state-only pattern as the field
  // editors above, just appending instead of mapping an existing record.
  const handleAddVendor = useCallback((record: VendorRecord) => {
    setVendors((prev) => [...prev, record]);
    setSelectedName(record.vendor_name);
    setStatusMessage(
      `Added "${record.vendor_name}" to the viewer (not yet saved to disk). Click "Save vendor" to persist it.`
    );
  }, []);

  const handleCreateModalClosed = useCallback(() => {
    setIsCreateModalOpen(false);
    addVendorButtonRef.current?.focus();
  }, []);

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
        <header className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Vendors Editor</h1>
            <p aria-live="polite" className="mt-2 text-sm text-green-700">
              {statusMessage}
            </p>
          </div>

          <fieldset className="flex flex-wrap items-center gap-3 border-0 p-0 m-0">
            <legend className="mb-2.5 text-sm font-bold text-gray-500">TRACKING:</legend>

            <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Status
              <select
                value={selected?.tracking_status ?? ""}
                onChange={(e) =>
                  setVendors((prev) =>
                    prev.map((v) =>
                      v.vendor_name === selectedName
                        ? { ...v, tracking_status: (e.target.value as "ready for site" | "published to site") || null }
                        : v
                    )
                  )
                }
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">set status</option>
                <option value="ready for site">ready for site</option>
                <option value="published to site">published to site</option>
              </select>
            </label>
          </fieldset>
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
              ref={editHeaderButtonRef}
              onClick={() => setIsHeaderEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Header
            </button>

            <button
              type="button"
              ref={editGlobalResourcesButtonRef}
              onClick={() => setIsGlobalResourcesEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Global Resources
            </button>

            <button
              type="button"
              ref={editProductsButtonRef}
              onClick={() => setIsProductsEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Product/s
            </button>

            <button
              type="button"
              ref={editSupportButtonRef}
              onClick={() => setIsSupportEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Support
            </button>

            {/* Always enabled (no `disabled={!selected}`), unlike the four
                edit buttons above -- creating a new vendor has no
                dependency on a vendor already being selected. Styled like
                /editor's "Import Candidate" button (ml-3.5 bg-blue-600
                primary action, separated from the edit-action siblings). */}
            <button
              type="button"
              ref={addVendorButtonRef}
              onClick={() => setIsCreateModalOpen(true)}
              className="ml-3.5 rounded border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add Vendor
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

        {isHeaderEditorOpen && selected ? (
          // key forces a fresh mount per record, so a future refactor that
          // keeps the editor mounted across a selection change cannot
          // silently leak one record's draft into another.
          <VendorHeaderEditor
            key={selected.vendor_name}
            record={selected}
            onSave={handleHeaderSave}
            onClose={handleHeaderEditorClosed}
          />
        ) : null}

        {isGlobalResourcesEditorOpen && selected ? (
          <VendorGlobalResourcesEditor
            key={selected.vendor_name}
            record={selected}
            onSave={handleGlobalResourcesSave}
            onClose={handleGlobalResourcesEditorClosed}
          />
        ) : null}

        {isProductsEditorOpen && selected ? (
          <VendorProductsEditor
            key={selected.vendor_name}
            record={selected}
            onSave={handleProductsSave}
            onClose={handleProductsEditorClosed}
          />
        ) : null}

        {isSupportEditorOpen && selected ? (
          <VendorSupportEditor
            key={selected.vendor_name}
            record={selected}
            onSave={handleSupportSave}
            onClose={handleSupportEditorClosed}
          />
        ) : null}

        {isCreateModalOpen ? (
          <VendorCreateModal
            isOpen={isCreateModalOpen}
            existingVendorNames={vendors.map((v) => v.vendor_name)}
            onAdd={handleAddVendor}
            onClose={handleCreateModalClosed}
          />
        ) : null}
      </div>
    </div>
  );
}
