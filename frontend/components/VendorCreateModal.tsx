// frontend/components/VendorCreateModal.tsx
"use client";

/**
 * Unified "Add Vendor" modal for the /vendors visual editor. Unlike the
 * four field-group editors (VendorHeaderEditor, VendorGlobalResourcesEditor,
 * VendorProductsEditor, VendorSupportEditor), which each edit one section of
 * an EXISTING VendorRecord, this modal authors a brand-new VendorRecord from
 * scratch in one scrollable form -- there is no record to key off of yet, so
 * every field starts empty/default rather than seeded from a prop.
 *
 * Dialog architecture matches the other vendor editors: native <dialog> +
 * showModal(), no aria-modal, and the effect cleanup does NOT call
 * dialog.close() -- see VendorHeaderEditor.tsx / PublishedHeaderEditor.tsx
 * for why (React 19 Strict Mode's dev-only double-invoke can turn a
 * cleanup-time close() into a phantom close event landing on a freshly
 * re-attached listener).
 *
 * Mount/unmount, not the `isOpen` prop, is what resets the draft: /vendors/
 * page.tsx only renders this component while isCreateModalOpen is true (see
 * that file), so a fresh mount always starts from makeEmptyDraft() via
 * useState's lazy initializer. `isOpen` is kept as an explicit prop (rather
 * than assuming "mounted implies open") so the showModal() effect has a
 * real guard instead of an implicit one -- but resetting draft state
 * whenever `isOpen` flips true would mean calling setState synchronously
 * inside an effect body (the exact react-hooks/set-state-in-effect pattern
 * SectionEditor.tsx already trips on), so this component deliberately does
 * NOT watch `isOpen` to reset state; a full remount is the reset mechanism.
 *
 * Row identity: like the individual editors, VendorResource/VendorProductLink/
 * PublishedSupportContact rows get a client-only id (crypto.randomUUID())
 * for React keys and focus-targeting -- never persisted; onAdd strips it
 * back down to each type's real shape (VendorResource keeps `id` since that
 * field is part of its persisted shape, unlike the other two row types).
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { PublishedSupportContact } from "@/lib/published-tables";
import type { VendorProductLink, VendorRecord, VendorResource } from "@/lib/vendor-schema";

interface VendorCreateModalProps {
  isOpen: boolean;
  existingVendorNames: string[];
  onAdd: (record: VendorRecord) => void;
  onClose: () => void;
}

type ResourceSource = "Internal" | "External";
type ContactType = "email" | "url";

interface DraftResourceRow {
  id: string;
  text: string;
  url: string;
  source: ResourceSource;
  label: string;
  date: string;
  addedToSite: boolean;
}

interface DraftProductRow {
  id: string;
  product_name: string;
  ncademi_product_url: string;
}

interface DraftContactRow {
  id: string;
  type: ContactType;
  value: string;
  label: string;
}

interface Draft {
  vendor_name: string;
  vendor_website_url: string;
  vendor_directory_url: string;
  notes: string;
  added_to_site: boolean;
  resources: DraftResourceRow[];
  products: DraftProductRow[];
  support_contacts: DraftContactRow[];
}

function makeEmptyDraft(): Draft {
  return {
    vendor_name: "",
    vendor_website_url: "",
    vendor_directory_url: "",
    notes: "",
    added_to_site: false,
    resources: [],
    products: [],
    support_contacts: [],
  };
}

function makeRowId(): string {
  return crypto.randomUUID();
}

/** Empty input maps to null, matching VendorRecord's nullable string fields
 *  -- an empty string is not the "no value" signal the rest of the schema
 *  uses (see PublishedHeaderEditor's toRecordValue). */
function toRecordValue(v: string): string | null {
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/** Sentinels distinguishing "focus the Add ___ button" from any row id in
 *  that same section (crypto.randomUUID() never produces these strings). */
const ADD_RESOURCE_FOCUS_ID = "__add_resource_button__";
const ADD_PRODUCT_FOCUS_ID = "__add_product_button__";
const ADD_CONTACT_FOCUS_ID = "__add_contact_button__";

export function VendorCreateModal({ isOpen, existingVendorNames, onAdd, onClose }: VendorCreateModalProps) {
  // Lazy initializer: runs exactly once on mount. A fresh mount (see the
  // file header) is this component's only reset path -- there is no effect
  // that re-seeds `draft` in response to `isOpen` changing.
  const [draft, setDraft] = useState<Draft>(() => makeEmptyDraft());

  const dialogRef = useRef<HTMLDialogElement>(null);

  const resourceAddButtonRef = useRef<HTMLButtonElement>(null);
  const productAddButtonRef = useRef<HTMLButtonElement>(null);
  const contactAddButtonRef = useRef<HTMLButtonElement>(null);
  // Keyed by row id rather than index, since indices shift on remove.
  const resourceTextInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const productNameInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const contactValueInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  // Set from event handlers (add/remove), consumed by the focus effects
  // below and cleared there. A ref rather than state -- see
  // PublishedVendorResourcesEditor's header comment on why.
  const pendingResourceFocusIdRef = useRef<string | null>(null);
  const pendingProductFocusIdRef = useRef<string | null>(null);
  const pendingContactFocusIdRef = useRef<string | null>(null);

  // Written from an effect (post-render), read only in event handlers --
  // never mutated during render itself. Mirrors PublishedHeaderEditor's
  // isDirtyRef pattern. Since this modal always starts from the same empty
  // draft (see the file header), "dirty" collapses to "the user has typed
  // or added something."
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current =
      draft.vendor_name !== "" ||
      draft.vendor_website_url !== "" ||
      draft.vendor_directory_url !== "" ||
      draft.notes !== "" ||
      draft.added_to_site !== false ||
      draft.resources.length > 0 ||
      draft.products.length > 0 ||
      draft.support_contacts.length > 0;
  });

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const nameId = `${baseId}-name`;
  const nameHintId = `${baseId}-name-hint`;
  const websiteId = `${baseId}-website`;
  const websiteHintId = `${baseId}-website-hint`;
  const directoryId = `${baseId}-directory`;
  const notesId = `${baseId}-notes`;
  const addedId = `${baseId}-added`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();

    const handleCancel = (event: Event) => {
      // Esc fires 'cancel' then 'close'. Without this, Esc discards
      // in-progress entries with no prompt.
      if (isDirtyRef.current && !window.confirm("Discard this new vendor?")) {
        event.preventDefault();
      }
    };
    const handleClose = () => onClose();

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [isOpen, onClose]);

  // Consumes a pending focus request once the target's ref has settled
  // after the render it was requested in. Runs after every resources
  // change; a no-op whenever nothing is pending, e.g. a plain field edit.
  useEffect(() => {
    const target = pendingResourceFocusIdRef.current;
    if (target === null) return;
    if (target === ADD_RESOURCE_FOCUS_ID) {
      resourceAddButtonRef.current?.focus();
    } else {
      resourceTextInputRefs.current.get(target)?.focus();
    }
    pendingResourceFocusIdRef.current = null;
  }, [draft.resources]);

  useEffect(() => {
    const target = pendingProductFocusIdRef.current;
    if (target === null) return;
    if (target === ADD_PRODUCT_FOCUS_ID) {
      productAddButtonRef.current?.focus();
    } else {
      productNameInputRefs.current.get(target)?.focus();
    }
    pendingProductFocusIdRef.current = null;
  }, [draft.products]);

  useEffect(() => {
    const target = pendingContactFocusIdRef.current;
    if (target === null) return;
    if (target === ADD_CONTACT_FOCUS_ID) {
      contactAddButtonRef.current?.focus();
    } else {
      contactValueInputRefs.current.get(target)?.focus();
    }
    pendingContactFocusIdRef.current = null;
  }, [draft.support_contacts]);

  const requestClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isDirtyRef.current && !window.confirm("Discard this new vendor?")) return;
    dialog.close();
  }, []);

  // ---- Header field handlers ----

  const handleVendorNameChange = useCallback((value: string) => {
    setDraft((prev) => ({ ...prev, vendor_name: value }));
  }, []);

  const handleWebsiteUrlChange = useCallback((value: string) => {
    setDraft((prev) => ({ ...prev, vendor_website_url: value }));
  }, []);

  const handleDirectoryUrlChange = useCallback((value: string) => {
    setDraft((prev) => ({ ...prev, vendor_directory_url: value }));
  }, []);

  const handleNotesChange = useCallback((value: string) => {
    setDraft((prev) => ({ ...prev, notes: value }));
  }, []);

  const handleAddedToSiteChange = useCallback((value: boolean) => {
    setDraft((prev) => ({ ...prev, added_to_site: value }));
  }, []);

  // ---- Global resources handlers ----

  const handleAddResourceRow = useCallback(() => {
    const id = makeRowId();
    pendingResourceFocusIdRef.current = id;
    setDraft((prev) => ({
      ...prev,
      resources: [
        ...prev.resources,
        { id, text: "", url: "", source: "Internal", label: "", date: "", addedToSite: false },
      ],
    }));
  }, []);

  const handleRemoveResourceRow = useCallback(
    (id: string) => {
      const index = draft.resources.findIndex((r) => r.id === id);
      if (index === -1) return;
      // Computed from the CURRENT rows, before removal -- see
      // PublishedVendorResourcesEditor's header comment on why.
      const focusTarget =
        draft.resources[index + 1]?.id ?? draft.resources[index - 1]?.id ?? ADD_RESOURCE_FOCUS_ID;
      pendingResourceFocusIdRef.current = focusTarget;
      setDraft((prev) => ({ ...prev, resources: prev.resources.filter((r) => r.id !== id) }));
    },
    [draft.resources]
  );

  const handleResourceTextChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      resources: prev.resources.map((r) => (r.id === id ? { ...r, text: value } : r)),
    }));
  }, []);

  const handleResourceUrlChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      resources: prev.resources.map((r) => (r.id === id ? { ...r, url: value } : r)),
    }));
  }, []);

  const handleResourceSourceChange = useCallback((id: string, value: ResourceSource) => {
    setDraft((prev) => ({
      ...prev,
      resources: prev.resources.map((r) => (r.id === id ? { ...r, source: value } : r)),
    }));
  }, []);

  const handleResourceLabelChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      resources: prev.resources.map((r) => (r.id === id ? { ...r, label: value } : r)),
    }));
  }, []);

  const handleResourceDateChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      resources: prev.resources.map((r) => (r.id === id ? { ...r, date: value } : r)),
    }));
  }, []);

  const handleResourceAddedToSiteChange = useCallback((id: string, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      resources: prev.resources.map((r) => (r.id === id ? { ...r, addedToSite: value } : r)),
    }));
  }, []);

  // ---- Products handlers ----

  const handleAddProductRow = useCallback(() => {
    const id = makeRowId();
    pendingProductFocusIdRef.current = id;
    setDraft((prev) => ({
      ...prev,
      products: [...prev.products, { id, product_name: "", ncademi_product_url: "" }],
    }));
  }, []);

  const handleRemoveProductRow = useCallback(
    (id: string) => {
      const index = draft.products.findIndex((p) => p.id === id);
      if (index === -1) return;
      const focusTarget =
        draft.products[index + 1]?.id ?? draft.products[index - 1]?.id ?? ADD_PRODUCT_FOCUS_ID;
      pendingProductFocusIdRef.current = focusTarget;
      setDraft((prev) => ({ ...prev, products: prev.products.filter((p) => p.id !== id) }));
    },
    [draft.products]
  );

  const handleProductNameChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, product_name: value } : p)),
    }));
  }, []);

  const handleProductUrlChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, ncademi_product_url: value } : p)),
    }));
  }, []);

  // ---- Support contacts handlers ----

  const handleAddContactRow = useCallback(() => {
    const id = makeRowId();
    pendingContactFocusIdRef.current = id;
    setDraft((prev) => ({
      ...prev,
      support_contacts: [...prev.support_contacts, { id, type: "email", value: "", label: "" }],
    }));
  }, []);

  const handleRemoveContactRow = useCallback(
    (id: string) => {
      const index = draft.support_contacts.findIndex((c) => c.id === id);
      if (index === -1) return;
      const focusTarget =
        draft.support_contacts[index + 1]?.id ??
        draft.support_contacts[index - 1]?.id ??
        ADD_CONTACT_FOCUS_ID;
      pendingContactFocusIdRef.current = focusTarget;
      setDraft((prev) => ({
        ...prev,
        support_contacts: prev.support_contacts.filter((c) => c.id !== id),
      }));
    },
    [draft.support_contacts]
  );

  const handleContactTypeChange = useCallback((id: string, value: ContactType) => {
    setDraft((prev) => ({
      ...prev,
      support_contacts: prev.support_contacts.map((c) => (c.id === id ? { ...c, type: value } : c)),
    }));
  }, []);

  const handleContactValueChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      support_contacts: prev.support_contacts.map((c) => (c.id === id ? { ...c, value } : c)),
    }));
  }, []);

  const handleContactLabelChange = useCallback((id: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      support_contacts: prev.support_contacts.map((c) => (c.id === id ? { ...c, label: value } : c)),
    }));
  }, []);

  // ---- Submit ----

  const trimmedName = draft.vendor_name.trim();
  const isNameEmpty = trimmedName === "";
  // Exact match against the trimmed name, matching vendor_name's use as an
  // exact-string join key everywhere else in vendors.json (see
  // vendor-schema.ts) -- not a case-insensitive comparison.
  const isDuplicateName = !isNameEmpty && existingVendorNames.includes(trimmedName);
  const isAddDisabled = isNameEmpty || isDuplicateName;

  const nameStatusId = `${baseId}-name-status`;
  const nameDescribedBy = `${nameHintId} ${nameStatusId}`;

  const handleAdd = useCallback(() => {
    if (isAddDisabled) return;

    const resources: VendorResource[] = draft.resources
      // Drop rows the user added but never filled in -- an all-blank row
      // carries no information worth persisting.
      .filter((r) => r.text.trim() !== "" || r.url.trim() !== "")
      .map((r) => ({
        id: r.id,
        text: r.text.trim(),
        url: r.url.trim(),
        source: r.source,
        label: toRecordValue(r.label),
        date: toRecordValue(r.date),
        added_to_site: r.addedToSite,
      }));

    const products: VendorProductLink[] = draft.products
      .filter((p) => p.product_name.trim() !== "" || p.ncademi_product_url.trim() !== "")
      .map((p) => ({
        product_name: p.product_name.trim(),
        ncademi_product_url: p.ncademi_product_url.trim(),
      }));

    const support_contacts: PublishedSupportContact[] = draft.support_contacts
      .filter((c) => c.value.trim() !== "")
      .map((c) => ({
        type: c.type,
        value: c.value.trim(),
        label: toRecordValue(c.label),
      }));

    const record: VendorRecord = {
      vendor_name: trimmedName,
      vendor_website_url: toRecordValue(draft.vendor_website_url),
      vendor_directory_url: toRecordValue(draft.vendor_directory_url),
      // Free-text AppSheet export timestamp elsewhere in this schema (see
      // vendor-schema.ts) -- null here since this record has no AppSheet
      // provenance, same reasoning as support_contacts defaulting to
      // unpopulated for scraped vendors.
      last_updated: null,
      added_to_site: draft.added_to_site,
      notes: toRecordValue(draft.notes),
      resources,
      products,
      support_contacts,
    };

    onAdd(record);
    // Closing the dialog fires the native "close" event, which calls
    // onClose() -- the single path that unmounts this component.
    dialogRef.current?.close();
  }, [draft, isAddDisabled, trimmedName, onAdd]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="w-full max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-gray-900/50"
    >
      <h2 id={titleId} className="mb-4 text-lg font-bold text-gray-900">
        Add Vendor
      </h2>

      <div className="flex max-h-[75vh] flex-col gap-8 overflow-y-auto pr-1">
        {/* ---- Header ---- */}
        <section aria-labelledby={`${baseId}-header-heading`} className="flex flex-col gap-4">
          <h3 id={`${baseId}-header-heading`} className="text-sm font-bold uppercase tracking-wide text-gray-500">
            Header
          </h3>

          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-gray-700">
              Vendor name <span aria-hidden="true" className="text-red-700">*</span>
              <span className="sr-only"> (required)</span>
            </label>
            <input
              id={nameId}
              type="text"
              required
              aria-required="true"
              value={draft.vendor_name}
              onChange={(e) => handleVendorNameChange(e.target.value)}
              aria-describedby={nameDescribedBy}
              aria-invalid={isDuplicateName ? true : undefined}
              autoFocus
              className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p id={nameHintId} className="mt-1 text-xs text-gray-500">
              Required. Also the join key used to match this vendor&apos;s resources elsewhere in
              vendors.json.
            </p>
            {/* Rendered unconditionally, aria-live so the duplicate-name
                warning is announced as the user types -- not just on a
                blocked submit attempt, since "Show in Viewer" is disabled
                rather than rejected. */}
            <p id={nameStatusId} role="status" aria-live="polite" className="mt-1 text-xs font-semibold text-red-700">
              {isDuplicateName ? `A vendor named "${trimmedName}" already exists.` : ""}
            </p>
          </div>

          <div>
            <label htmlFor={websiteId} className="mb-1 block text-sm font-medium text-gray-700">
              Vendor website URL
            </label>
            <input
              id={websiteId}
              type="url"
              inputMode="url"
              value={draft.vendor_website_url}
              onChange={(e) => handleWebsiteUrlChange(e.target.value)}
              aria-describedby={websiteHintId}
              placeholder="https://example.com"
              className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p id={websiteHintId} className="mt-1 text-xs text-gray-500">
              Leave blank to clear -- stored as null, not an empty string.
            </p>
          </div>

          <div>
            <label htmlFor={directoryId} className="mb-1 block text-sm font-medium text-gray-700">
              NCADEMI vendor URL
            </label>
            <input
              id={directoryId}
              type="url"
              inputMode="url"
              value={draft.vendor_directory_url}
              onChange={(e) => handleDirectoryUrlChange(e.target.value)}
              placeholder="https://ncademi.org/provide/directory/vendors/example/"
              className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor={notesId} className="mb-1 block text-sm font-medium text-gray-700">
              Notes
            </label>
            <textarea
              id={notesId}
              value={draft.notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              rows={4}
              className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id={addedId}
              type="checkbox"
              checked={draft.added_to_site}
              onChange={(e) => handleAddedToSiteChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor={addedId} className="text-sm font-medium text-gray-700">
              Added to site
            </label>
          </div>
        </section>

        {/* ---- Global resources ---- */}
        <section aria-labelledby={`${baseId}-resources-heading`} className="flex flex-col gap-4">
          <h3
            id={`${baseId}-resources-heading`}
            className="text-sm font-bold uppercase tracking-wide text-gray-500"
          >
            Global Resources
          </h3>

          {draft.resources.length === 0 ? (
            <p className="text-sm text-gray-500">No global resources yet.</p>
          ) : (
            draft.resources.map((row, index) => {
              const textId = `${baseId}-resource-text-${row.id}`;
              const urlId = `${baseId}-resource-url-${row.id}`;
              const sourceId = `${baseId}-resource-source-${row.id}`;
              const labelId = `${baseId}-resource-label-${row.id}`;
              const dateId = `${baseId}-resource-date-${row.id}`;
              const rowAddedId = `${baseId}-resource-added-${row.id}`;
              return (
                <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Resource {index + 1}
                  </legend>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label htmlFor={textId} className="mb-1 block text-sm font-medium text-gray-700">
                        Link text
                      </label>
                      <input
                        id={textId}
                        ref={(el) => {
                          if (el) resourceTextInputRefs.current.set(row.id, el);
                          else resourceTextInputRefs.current.delete(row.id);
                        }}
                        type="text"
                        value={row.text}
                        onChange={(e) => handleResourceTextChange(row.id, e.target.value)}
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label htmlFor={urlId} className="mb-1 block text-sm font-medium text-gray-700">
                        URL
                      </label>
                      <input
                        id={urlId}
                        type="url"
                        inputMode="url"
                        value={row.url}
                        onChange={(e) => handleResourceUrlChange(row.id, e.target.value)}
                        placeholder="https://example.com"
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={sourceId} className="mb-1 block text-sm font-medium text-gray-700">
                          Source
                        </label>
                        <select
                          id={sourceId}
                          value={row.source}
                          onChange={(e) => handleResourceSourceChange(row.id, e.target.value as ResourceSource)}
                          className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="Internal">Internal</option>
                          <option value="External">External</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor={labelId} className="mb-1 block text-sm font-medium text-gray-700">
                          Label <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <input
                          id={labelId}
                          type="text"
                          value={row.label}
                          onChange={(e) => handleResourceLabelChange(row.id, e.target.value)}
                          placeholder="e.g. Statement/Policy"
                          className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor={dateId} className="mb-1 block text-sm font-medium text-gray-700">
                        Date <span className="font-normal text-gray-400">(optional, free text)</span>
                      </label>
                      <input
                        id={dateId}
                        type="text"
                        value={row.date}
                        onChange={(e) => handleResourceDateChange(row.id, e.target.value)}
                        placeholder="2/17/2026 9:35:34 AM"
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <input
                          id={rowAddedId}
                          type="checkbox"
                          checked={row.addedToSite}
                          onChange={(e) => handleResourceAddedToSiteChange(row.id, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <label htmlFor={rowAddedId} className="text-sm font-medium text-gray-700">
                          Added to site
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveResourceRow(row.id)}
                        aria-label={`Remove resource ${index + 1}${row.text ? `: ${row.text}` : ""}`}
                        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </fieldset>
              );
            })
          )}

          <button
            type="button"
            ref={resourceAddButtonRef}
            onClick={handleAddResourceRow}
            className="self-start rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Add resource
          </button>
        </section>

        {/* ---- Products ---- */}
        <section aria-labelledby={`${baseId}-products-heading`} className="flex flex-col gap-4">
          <h3
            id={`${baseId}-products-heading`}
            className="text-sm font-bold uppercase tracking-wide text-gray-500"
          >
            Product/s
          </h3>

          {draft.products.length === 0 ? (
            <p className="text-sm text-gray-500">No products linked yet.</p>
          ) : (
            draft.products.map((row, index) => {
              const nameFieldId = `${baseId}-product-name-${row.id}`;
              const urlFieldId = `${baseId}-product-url-${row.id}`;
              return (
                <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Product {index + 1}
                  </legend>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label htmlFor={nameFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                        Product name
                      </label>
                      <input
                        id={nameFieldId}
                        ref={(el) => {
                          if (el) productNameInputRefs.current.set(row.id, el);
                          else productNameInputRefs.current.delete(row.id);
                        }}
                        type="text"
                        value={row.product_name}
                        onChange={(e) => handleProductNameChange(row.id, e.target.value)}
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label htmlFor={urlFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                        NCADEMI product URL
                      </label>
                      <input
                        id={urlFieldId}
                        type="url"
                        inputMode="url"
                        value={row.ncademi_product_url}
                        onChange={(e) => handleProductUrlChange(row.id, e.target.value)}
                        placeholder="https://ncademi.org/provide/directory/products/example/"
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveProductRow(row.id)}
                      aria-label={`Remove product ${index + 1}${row.product_name ? `: ${row.product_name}` : ""}`}
                      className="self-end rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      Remove
                    </button>
                  </div>
                </fieldset>
              );
            })
          )}

          <button
            type="button"
            ref={productAddButtonRef}
            onClick={handleAddProductRow}
            className="self-start rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Add product
          </button>
        </section>

        {/* ---- Support contacts ---- */}
        <section aria-labelledby={`${baseId}-support-heading`} className="flex flex-col gap-4">
          <h3
            id={`${baseId}-support-heading`}
            className="text-sm font-bold uppercase tracking-wide text-gray-500"
          >
            Support
          </h3>

          {draft.support_contacts.length === 0 ? (
            <p className="text-sm text-gray-500">No support contacts yet.</p>
          ) : (
            draft.support_contacts.map((row, index) => {
              const typeFieldId = `${baseId}-contact-type-${row.id}`;
              const valueFieldId = `${baseId}-contact-value-${row.id}`;
              const labelFieldId = `${baseId}-contact-label-${row.id}`;
              return (
                <fieldset key={row.id} className="rounded border border-gray-200 p-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Contact {index + 1}
                  </legend>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label htmlFor={typeFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                        Contact type
                      </label>
                      <select
                        id={typeFieldId}
                        value={row.type}
                        onChange={(e) => handleContactTypeChange(row.id, e.target.value as ContactType)}
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="email">Email</option>
                        <option value="url">URL</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor={valueFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                        {row.type === "email" ? "Email address" : "URL"}
                      </label>
                      <input
                        id={valueFieldId}
                        ref={(el) => {
                          if (el) contactValueInputRefs.current.set(row.id, el);
                          else contactValueInputRefs.current.delete(row.id);
                        }}
                        type={row.type === "email" ? "email" : "url"}
                        inputMode={row.type === "email" ? "email" : "url"}
                        value={row.value}
                        onChange={(e) => handleContactValueChange(row.id, e.target.value)}
                        placeholder={row.type === "email" ? "support@example.com" : "https://example.com/support"}
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label htmlFor={labelFieldId} className="mb-1 block text-sm font-medium text-gray-700">
                        Label <span className="font-normal text-gray-400">(optional)</span>
                      </label>
                      <input
                        id={labelFieldId}
                        type="text"
                        value={row.label}
                        onChange={(e) => handleContactLabelChange(row.id, e.target.value)}
                        placeholder="e.g. Accessibility support"
                        className="w-full rounded border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveContactRow(row.id)}
                      aria-label={`Remove contact ${index + 1}${row.value ? `: ${row.value}` : ""}`}
                      className="self-end rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      Remove
                    </button>
                  </div>
                </fieldset>
              );
            })
          )}

          <button
            type="button"
            ref={contactAddButtonRef}
            onClick={handleAddContactRow}
            className="self-start rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Add contact
          </button>
        </section>
      </div>

      <div className="mt-4 flex justify-end gap-3 border-t border-gray-200 pt-4">
        <button
          type="button"
          onClick={requestClose}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={isAddDisabled}
          className="rounded border border-transparent bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Show in Viewer
        </button>
      </div>
    </dialog>
  );
}
