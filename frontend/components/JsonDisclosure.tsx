// frontend/components/JsonDisclosure.tsx
"use client";

/**
 * Read-only nested-JSON viewer built on native <details>/<summary>.
 *
 * Why not the WAI-ARIA APG treeview pattern: that pattern needs roving
 * tabindex, full arrow-key handling, aria-expanded/aria-selected bookkeeping,
 * and type-ahead, and its selection-follows-focus model makes a screen reader
 * announce every node the user arrows past. It is designed for a navigation
 * tree. This is a read-only data inspector over a fixed 4-level shape, where
 * native disclosure gives correct semantics, keyboard operability, and a
 * visible focus ring with no ARIA and no dependency.
 *
 * Constraints this component holds to:
 *   - <summary> contains TEXT ONLY. Interactive content inside <summary> is
 *     the documented source of screen-reader trouble with this element, so
 *     the "open link" affordance is rendered in the leaf row, never the summary.
 *   - Empty arrays render as leaves, not as expandable-but-empty branches.
 *     28 of 60 records have an empty vendor_resources; an expandable node that
 *     reveals nothing is a dead end for a keyboard user.
 *   - Children live in a <div>, never a <p>. Block content inside <p> is a
 *     DOM-nesting violation and a hydration mismatch.
 */

import { useId } from "react";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface JsonDisclosureProps {
  name: string;
  value: JsonValue;
  /** Depth 0 renders open; deeper levels start collapsed. */
  depth?: number;
  /** Number of levels open on first render. */
  defaultOpenDepth?: number;
}

function countLabel(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? "" : "s"}`;
}

function branchSummary(name: string, value: JsonValue[] | Record<string, JsonValue>): string {
  if (Array.isArray(value)) return `${name} — ${countLabel(value.length, "item")}`;
  return `${name} — ${countLabel(Object.keys(value).length, "field")}`;
}

function isHttpUrl(v: string): boolean {
  return v.startsWith("https://") || v.startsWith("http://");
}

/** Renders a scalar, or an empty array/object, as a non-expandable row. */
function Leaf({ name, value }: { name: string; value: JsonValue }) {
  let rendered: React.ReactNode;
  let kind: string;

  if (value === null) {
    rendered = <span className="nerd-json-null">null</span>;
    kind = "null";
  } else if (Array.isArray(value)) {
    rendered = <span className="nerd-json-empty">empty list</span>;
    kind = "empty list";
  } else if (typeof value === "object") {
    rendered = <span className="nerd-json-empty">empty object</span>;
    kind = "empty object";
  } else if (typeof value === "string") {
    kind = "string";
    rendered = isHttpUrl(value) ? (
      <a className="nerd-json-link" href={value} rel="noreferrer noopener" target="_blank">
        {value}
        <span className="nerd-visually-hidden"> (opens in a new tab)</span>
      </a>
    ) : (
      <span className="nerd-json-string">{value === "" ? "(empty string)" : value}</span>
    );
  } else {
    rendered = <span className="nerd-json-scalar">{String(value)}</span>;
    kind = typeof value;
  }

  return (
    <div className="nerd-json-leaf">
      <span className="nerd-json-key">{name}</span>
      <span className="nerd-json-sep" aria-hidden="true">
        :
      </span>
      <span className="nerd-json-value" data-kind={kind}>
        {rendered}
      </span>
    </div>
  );
}

export function JsonDisclosure({
  name,
  value,
  depth = 0,
  defaultOpenDepth = 1,
}: JsonDisclosureProps) {
  const contentId = useId();

  const isEmptyContainer =
    (Array.isArray(value) && value.length === 0) ||
    (value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === 0);

  if (value === null || typeof value !== "object" || isEmptyContainer) {
    return <Leaf name={name} value={value} />;
  }

  const entries: Array<[string, JsonValue]> = Array.isArray(value)
    ? value.map((v, i) => [`${i + 1}`, v])
    : Object.entries(value);

  return (
    <details className="nerd-json-branch" open={depth < defaultOpenDepth}>
      <summary className="nerd-json-summary">{branchSummary(name, value)}</summary>
      {/* Block-level children stay in a div. Never a <p>. */}
      <div className="nerd-json-children" id={contentId}>
        {entries.map(([k, v]) => (
          <JsonDisclosure
            key={k}
            name={k}
            value={v}
            depth={depth + 1}
            defaultOpenDepth={defaultOpenDepth}
          />
        ))}
      </div>
    </details>
  );
}

/**
 * Top-level wrapper: renders a record's fields without wrapping the whole
 * record in one extra disclosure the user would always have to open first.
 */
export function JsonRecordDisclosure({
  record,
  defaultOpenDepth = 1,
}: {
  record: Record<string, JsonValue>;
  defaultOpenDepth?: number;
}) {
  return (
    <div className="nerd-json-root">
      {Object.entries(record).map(([k, v]) => (
        <JsonDisclosure key={k} name={k} value={v} depth={0} defaultOpenDepth={defaultOpenDepth} />
      ))}
    </div>
  );
}
