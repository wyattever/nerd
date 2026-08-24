// frontend/components/PublishedJsonWorkbench.tsx
"use client";

/**
 * Client shell for /tables/published. Owns the draft, the selection, and the
 * export. The Server Component above it does the data loading; this does the
 * state.
 *
 * Persistence model, stated plainly because it is easy to get wrong later:
 * edits live in memory only. published-tables.json is a build-time import,
 * and this app deploys as a Next standalone container on Cloud Run, so a
 * runtime filesystem write would be lost on the next revision, invisible to
 * other instances, and absent from git. Export downloads the whole file; the
 * reviewer drops it into frontend/lib/ and commits it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JsonRecordDisclosure, type JsonValue } from "@/components/JsonDisclosure";
import { RawJsonEditor } from "@/components/RawJsonEditor";
import { validateProductRecord, hasBlockingError } from "@/lib/published-validate";
import type { PublishedProductRecord } from "@/lib/published-tables";

export interface SnapshotMeta {
  purpose: string;
  source_listing_url: string;
  snapshot_taken_at: string;
  total_products: number;
  generated_from: string;
}

interface WorkbenchProps {
  products: PublishedProductRecord[];
  meta: SnapshotMeta;
  schemaVersion: number;
  /** From ?slug= on the server. Used only for the initial selection. */
  initialSlug: string;
}

type ViewMode = "structured" | "raw";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 10)} at ${d.toISOString().slice(11, 16)} UTC`;
}

export function PublishedJsonWorkbench({
  products,
  meta,
  schemaVersion,
  initialSlug,
}: WorkbenchProps) {
  const [draft, setDraft] = useState<PublishedProductRecord[]>(products);
  const [editedSlugs, setEditedSlugs] = useState<ReadonlySet<string>>(new Set());
  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const [viewMode, setViewMode] = useState<ViewMode>("structured");
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");

  const editButtonRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(
    () => draft.find((p) => p.slug === selectedSlug) ?? draft[0] ?? null,
    [draft, selectedSlug]
  );
  const allSlugs = useMemo(() => draft.map((p) => p.slug), [draft]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return draft;
    return draft.filter(
      (p) => p.slug.includes(q) || p.product_name.toLowerCase().includes(q)
    );
  }, [draft, filter]);

  // Records that are already invalid before anyone touches them. On the
  // 2026-08-21 snapshot this is zero; it is here so a bad re-scrape is visible
  // rather than silent.
  const invalidSlugs = useMemo(() => {
    const bad = new Set<string>();
    for (const p of draft) {
      if (hasBlockingError(validateProductRecord(p))) bad.add(p.slug);
    }
    return bad;
  }, [draft]);

  // Only attached while there is something to lose. A permanently-registered
  // beforeunload listener also disables the browser's back/forward cache.
  useEffect(() => {
    if (editedSlugs.size === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy engines still need returnValue set. No browser shows a custom
      // string; the generic warning is all we can get.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editedSlugs.size]);

  const handleSave = useCallback(
    (next: PublishedProductRecord) => {
      const previousSlug = selectedSlug;
      setDraft((prev) => prev.map((p) => (p.slug === previousSlug ? next : p)));
      setEditedSlugs((prev) => {
        const s = new Set(prev);
        s.delete(previousSlug);
        s.add(next.slug);
        return s;
      });
      setSelectedSlug(next.slug);
      setStatus(`Saved changes to ${next.product_name} in this session.`);
    },
    [selectedSlug]
  );

  const handleEditorClosed = useCallback(() => {
    setIsEditing(false);
    // Focus must come back to what opened the dialog.
    editButtonRef.current?.focus();
  }, []);

  const handleExport = useCallback(() => {
    const blocking = draft.filter((p) => hasBlockingError(validateProductRecord(p)));
    if (blocking.length > 0) {
      setStatus(
        `Export blocked. ${blocking.length} record${blocking.length === 1 ? "" : "s"} would not validate: ${blocking
          .map((p) => p.slug)
          .join(", ")}.`
      );
      return;
    }

    // $meta describes the SCRAPE, not this edit. Rewriting snapshot_taken_at
    // here would falsely claim the data was re-fetched from ncademi.org.
    const file = { $schema_version: schemaVersion, $meta: meta, products: draft };
    const blob = new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "published-tables.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // Revoking synchronously after click() can be too early in some engines.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setStatus(
      `Download started: published-tables.json, ${draft.length} records, ${editedSlugs.size} edited this session. Move it into frontend/lib/ and commit it.`
    );
  }, [draft, meta, schemaVersion, editedSlugs.size]);

  if (!selected) {
    return <p className="nerd-json-empty-state">The snapshot contains no products.</p>;
  }

  return (
    <div className="nerd-json-workbench">
      <nav aria-label="Products in the snapshot" className="nerd-json-sidebar">
        <label className="nerd-json-label" htmlFor="nerd-json-filter">
          Filter products
        </label>
        <input
          className="nerd-json-filter"
          id="nerd-json-filter"
          onChange={(e) => setFilter(e.target.value)}
          placeholder="slug or name"
          type="search"
          value={filter}
        />
        <p className="nerd-json-sidebar-count">
          {filtered.length} of {draft.length} shown
        </p>
        <ul className="nerd-json-list">
          {filtered.map((p) => {
            const isActive = p.slug === selected.slug;
            return (
              <li key={p.slug}>
                <button
                  aria-current={isActive ? "true" : undefined}
                  className={`nerd-json-list-item${isActive ? " is-active" : ""}`}
                  onClick={() => setSelectedSlug(p.slug)}
                  type="button"
                >
                  <span className="nerd-json-list-name">{p.product_name}</span>
                  <span className="nerd-json-list-slug">{p.slug}</span>
                  {editedSlugs.has(p.slug) ? (
                    <span className="nerd-json-badge nerd-json-badge--edited">edited</span>
                  ) : null}
                  {invalidSlugs.has(p.slug) ? (
                    <span className="nerd-json-badge nerd-json-badge--invalid">invalid</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="nerd-json-main" id="nerd-json-main">
        <div className="nerd-json-toolbar">
          <h2 className="nerd-json-record-title">{selected.product_name}</h2>

          <div className="nerd-json-viewmode" role="group" aria-label="View mode">
            <button
              aria-pressed={viewMode === "structured"}
              className="nerd-btn"
              onClick={() => setViewMode("structured")}
              type="button"
            >
              Structured
            </button>
            <button
              aria-pressed={viewMode === "raw"}
              className="nerd-btn"
              onClick={() => setViewMode("raw")}
              type="button"
            >
              Raw JSON
            </button>
          </div>

          <button
            className="nerd-btn nerd-btn--primary"
            onClick={() => setIsEditing(true)}
            ref={editButtonRef}
            type="button"
          >
            Edit raw JSON
          </button>
          <button className="nerd-btn" onClick={handleExport} type="button">
            Export file{editedSlugs.size > 0 ? ` (${editedSlugs.size} edited)` : ""}
          </button>
        </div>

        {/* Page-level status. Rendered unconditionally so the region exists
            in the DOM before anything is put into it. */}
        <p className="nerd-json-status" role="status" aria-live="polite">
          {status}
        </p>

        {viewMode === "structured" ? (
          <JsonRecordDisclosure record={selected as unknown as Record<string, JsonValue>} />
        ) : (
          // tabindex makes the scroll container keyboard-operable (2.1.1).
          <pre className="nerd-json-pre" tabIndex={0}>
            {JSON.stringify(selected, null, 2)}
          </pre>
        )}

        <footer className="nerd-json-meta">
          <p>
            Snapshot taken {formatTimestamp(meta.snapshot_taken_at)} from{" "}
            <a href={meta.source_listing_url} rel="noreferrer noopener" target="_blank">
              the NCADEMI directory listing
              <span className="nerd-visually-hidden"> (opens in a new tab)</span>
            </a>
            . {meta.total_products} products, schema version {schemaVersion}.
          </p>
          <p className="nerd-json-meta-note">
            Edits are held in this browser tab only. Use <strong>Export file</strong> to download
            the complete JSON, then move it into <code>frontend/lib/</code> and commit it.
          </p>
        </footer>
      </main>

      {isEditing ? (
        // key forces a fresh mount per record. The conditional render already
        // unmounts on close; key is the belt to that braces, so a future
        // refactor that keeps the editor mounted cannot silently leak one
        // record's draft into another.
        <RawJsonEditor
          allSlugs={allSlugs}
          key={selected.slug}
          onClose={handleEditorClosed}
          onSave={handleSave}
          record={selected}
        />
      ) : null}
    </div>
  );
}
