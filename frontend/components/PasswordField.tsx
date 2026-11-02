// frontend/components/PasswordField.tsx
"use client";

/**
 * The Tracking fieldset's vendor-review Password field, editable in place.
 * Saving goes through PUT /api/local/passwords, which sets the product's
 * password atomically server-side (mutatePasswords) and creates the row if
 * none exists.
 *
 * The "Save password" button is rendered only while the value differs from
 * the stored one, and sits as the very next element after the input (a
 * sibling of the <label>, not inside it, so it is not folded into the
 * input's accessible name). Keyboard and screen-reader users tabbing out of
 * an edited field reach it immediately; when nothing has changed there is
 * no inert control to tab past. Enter saves and Escape reverts, from the
 * input itself.
 *
 * After a successful save the value equals the stored one, so the button
 * unmounts. If it had focus, focus is moved back to the input first --
 * otherwise it would fall to <body> and a keyboard user would lose their
 * place. In-flight saves ignore repeat activations instead of using the
 * `disabled` attribute, for the same reason: a disabled control drops
 * focus.
 *
 * `editable={false}` is for when the passwords document failed to load:
 * the stored value is unknown, so the field is read-only rather than
 * letting a blind save overwrite a password the operator never saw.
 *
 * `size={9}` (roughly the label "Password"'s own width, plus a little room)
 * rather than a fixed Tailwind width, so the field stays sized to its label
 * regardless of the password's length. The read-only state uses readOnly,
 * not disabled: the value stays focusable, selectable and copyable.
 *
 * Outcomes are announced through the shared Messages footer (useMessages):
 * success in its role="status" region, failure in its role="alert" region.
 * Each save first clears the alert and sets "Saving password…", so the
 * final message is always a text change and is always announced -- even on
 * a repeated save that ends in the same message as the last one.
 * Focus is deliberately NOT moved there -- this is an inline edit, and
 * focus stays with the field.
 */

import { useRef, useState, type KeyboardEvent } from "react";
import { useMessages } from "@/components/IntegratedListPanel";
import type { PasswordRecord } from "@/lib/passwords";

const LABEL_CLASS = "flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500";
const EDITABLE_INPUT_CLASS =
  "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500";
const READ_ONLY_INPUT_CLASS =
  "rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-medium text-gray-700 cursor-default focus:outline-none focus:ring-2 focus:ring-blue-500";
const BUTTON_CLASS =
  "self-end rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface PasswordFieldProps {
  productName: string;
  vendorName: string | null;
  /** "" when no row exists. */
  storedPassword: string;
  /** false when the passwords document failed to load. */
  editable: boolean;
  onSaved: (record: PasswordRecord) => void;
}

function isPasswordRecord(value: unknown): value is PasswordRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return typeof r.product_name === "string" && typeof r.password === "string";
}

export function PasswordField({ productName, vendorName, storedPassword, editable, onSaved }: PasswordFieldProps) {
  const { setStatusMessage, setSaveError } = useMessages();
  const [value, setValue] = useState(storedPassword);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const dirty = value !== storedPassword;

  async function save() {
    if (savingRef.current || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setStatusMessage("Saving password…");
    const sent = value;
    const unreachable = `Password not saved for ${productName}: the server could not be reached.`;

    try {
      let res: Response;
      let body: unknown;
      try {
        res = await fetch("/api/local/passwords", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_name: productName, vendor_name: vendorName, password: sent }),
        });
        body = await res.json();
      } catch {
        setStatusMessage("");
        setSaveError(unreachable);
        setFailed(true);
        return;
      }

      if (!res.ok) {
        const error = (body as { error?: unknown } | null)?.error;
        setStatusMessage("");
        setSaveError(typeof error === "string" ? `Password not saved for ${productName}: ${error}` : unreachable);
        setFailed(true);
        return;
      }

      const { record, changed } = (body ?? {}) as { record?: unknown; changed?: unknown };
      if (!isPasswordRecord(record)) {
        setStatusMessage("");
        setSaveError(unreachable);
        setFailed(true);
        return;
      }

      const buttonHadFocus = document.activeElement === buttonRef.current;
      onSaved(record);
      // Adopt the server-trimmed value, unless the field was edited again
      // while the request was in flight.
      setValue((current) => (current === sent ? record.password : current));
      setFailed(false);
      setSaveError("");
      setStatusMessage(changed ? `Password saved for ${productName}.` : `Password unchanged for ${productName}.`);
      if (buttonHadFocus) inputRef.current?.focus();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!editable) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setValue(storedPassword);
      setFailed(false);
    }
  }

  return (
    <>
      <label className={LABEL_CLASS}>
        Password
        <input
          ref={inputRef}
          type="text"
          size={9}
          autoComplete="off"
          spellCheck={false}
          readOnly={!editable}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFailed(false);
          }}
          onKeyDown={handleKeyDown}
          aria-invalid={failed ? true : undefined}
          className={editable ? EDITABLE_INPUT_CLASS : READ_ONLY_INPUT_CLASS}
        />
      </label>
      {editable && dirty ? (
        <button ref={buttonRef} type="button" onClick={() => void save()} className={BUTTON_CLASS}>
          {saving ? "Saving…" : "Save password"}
        </button>
      ) : null}
    </>
  );
}
