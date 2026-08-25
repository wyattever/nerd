// frontend/components/PublishedJsonWorkbench.tsx
"use client";

/**
 * Client shell for /tables/published. Owns the draft, the selection, and
 * saving. The Server Component above it does the initial data load (from the
 * frozen static import); this component re-fetches from the local write API
 * on mount to get live disk bytes plus an ETag, and saves back through that
 * same API.
 *
 * Persistence model: in local development (NEXT_PUBLIC_DISABLE_AUTH=true,
 * NODE_ENV!=='production'), Save to disk POSTs the whole document to
 * /api/local/published, which validates again server-side, then atomically
 * overwrites frontend/lib/published-tables.json on disk (see
 * lib/local-write.ts and docs/NERD_System_Architecture.md). That write is NOT
 * itself a git commit -- the change still needs review and `git commit` like
 * any other edit. In a production build the API is gated to 404; the editor
 * still works against the server-rendered snapshot, and Save to disk fails
 * with a clear error rather than doing nothing silently.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  const [saveError, setSaveError] = useState("");
  const [filter, setFilter] = useState("");
  const [etag, setEtag] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

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

  // Refresh from the local write API on mount. The server-rendered `products`
  // prop comes from a build-time static import, which is frozen in process
  // memory and does not reflect a write that already landed on disk since
  // then -- the API reads fs fresh on every request instead. In a production
  // build (or anywhere the local API is gated off) this fetch fails
  // harmlessly and the editor keeps working against the static snapshot;
  // Save to disk simply has no ETag yet and reports that clearly rather than
  // silently no-opping.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/local/published");
        if (!res.ok || cancelled) return;
        const newEtag = res.headers.get("ETag");
        const body = (await res.json()) as { products?: unknown };
        if (cancelled) return;
        if (Array.isArray(body.products)) {
          setDraft(body.products as PublishedProductRecord[]);
        }
        if (newEtag) setEtag(newEtag);
      } catch {
        // Local write API unreachable -- editor still works against the
        // server-rendered snapshot.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Replaces the old client-side Blob download. POSTs the whole document to
  // the local-only write API, which validates again server-side and
  // atomically overwrites published-tables.json on disk. See
  // lib/local-write.ts and docs/NERD_System_Architecture.md for the write path.
  const handleSaveToServer = useCallback(() => {
    const blocking = draft.filter((p) => hasBlockingError(validateProductRecord(p)));
    if (blocking.length > 0) {
      setSaveError(
        `Save blocked. ${blocking.length} record${blocking.length === 1 ? "" : "s"} would not validate: ${blocking
          .map((p) => p.slug)
          .join(", ")}.`
      );
      return;
    }
    if (!etag) {
      setSaveError(
        "Cannot save: no ETag from the server. The local write API may be unavailable (this feature only works in local development)."
      );
      return;
    }

    setSaveError("");
    setStatus("Saving…");

    // $meta describes the SCRAPE, not this edit. Rewriting snapshot_taken_at
    // here would falsely claim the data was re-fetched from ncademi.org.
    const file = { $schema_version: schemaVersion, $meta: meta, products: draft };

    startSaveTransition(async () => {
      try {
        const res = await fetch("/api/local/published", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify(file),
        });

        if (res.status === 412) {
          setStatus("");
          setSaveError(
            "Save failed: the file on disk changed since this copy was loaded. Reload the page and re-apply your edits."
          );
          return;
        }

        if (res.status === 400) {
          const body = await res.json().catch(() => null);
          setStatus("");
          setSaveError(`Save failed: ${body?.error ?? "the server rejected this data."}`);
          return;
        }

        if (!res.ok) {
          setStatus("");
          setSaveError(`Save failed: unexpected server response (${res.status}).`);
          return;
        }

        const result = (await res.json()) as { etag?: string };
        const newEtag = res.headers.get("ETag") ?? result.etag ?? null;
        if (newEtag) setEtag(newEtag);
        setEditedSlugs(new Set());
        setSaveError("");
        setStatus(`Saved ${draft.length} records to published-tables.json on disk.`);
      } catch {
        setStatus("");
        setSaveError("Save failed: could not reach the local write API.");
      }
    });
  }, [draft, etag, meta, schemaVersion]);

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
          <button className="nerd-btn" disabled={isSaving} onClick={handleSaveToServer} type="button">
            {isSaving
              ? "Saving…"
              : `Save to disk${editedSlugs.size > 0 ? ` (${editedSlugs.size} edited)` : ""}`}
          </button>
        </div>

        {/* Page-level status. Rendered unconditionally so the region exists
            in the DOM before anything is put into it. Polite: "Saving…",
            per-record save confirmations, and the final "Saved" message. */}
        <p className="nerd-json-status" role="status" aria-live="polite">
          {status}
        </p>

        {/* Separate assertive region for save failures, so a 412/400/network
            error interrupts rather than waiting its turn behind polite
            announcements. Also rendered unconditionally, populated later --
            a live region created and filled in the same commit is
            frequently not announced at all. */}
        <p className="nerd-json-alert" role="alert">
          {saveError}
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
            <strong>Save to disk</strong> writes directly to{" "}
            <code>frontend/lib/published-tables.json</code> via the local-only write API, available in
            local development only. The write is not a git commit; review and commit the change
            afterward like any other edit.
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
