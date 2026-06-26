
import { useEffect, useRef, useState } from "react";
import { SectionKey } from "@/lib/types";

// ACCESSIBILITY NOTE: no manual focus trap is implemented here, by design. The
// W3C APA Working Group concluded showModal()'s native behavior (allowing Tab
// to reach browser chrome) is not a WCAG violation and is an intentional escape
// mechanism — see https://github.com/w3c/wcag/discussions/4987. If this is ever
// flagged in an audit, start from that discussion before adding a focus trap.

// SECURITY NOTE: the raw HTML typed here is rendered via dangerouslySetInnerHTML
// in ListingCard.tsx, sanitized through DOMPurify.sanitize() (HTML-only profile)
// immediately before DOM injection — see docs/SECTION_EDITOR_IMPLEMENTATION_PLAN_v4.md
// section 1. This textarea itself shows UNSANITIZED raw HTML — sanitization happens
// only at the render site, not here, so what you type is what you see while editing.

interface Props {
  sectionKey: SectionKey;
  label: string;
  initialHtml: string;
  isOverridden: boolean;
  generatedHtml: string;
  isOpen: boolean;
  onSave: (key: SectionKey, html: string) => void;
  onReset: (key: SectionKey) => void;
  onClose: () => void;
}

export function SectionEditor({
  sectionKey,
  label,
  initialHtml,
  isOverridden,
  generatedHtml,
  isOpen,
  onSave,
  onReset,
  onClose,
}: Props) {
  const [currentHtml, setCurrentHtml] = useState(initialHtml);
  const originalHtmlRef = useRef(initialHtml);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // --- Focus Restoration Logic ---
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const hasCapturedRef = useRef(false);

  useEffect(() => {
    if (!hasCapturedRef.current) {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
      hasCapturedRef.current = true;
    }
    return () => {
      triggerElementRef.current?.focus?.();
      hasCapturedRef.current = false;
    };
  }, []);

  // --- Dialog Lifecycle & State Sync ---
  useEffect(() => {
    if (isOpen) {
      setCurrentHtml(initialHtml);
      originalHtmlRef.current = initialHtml;
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [isOpen, initialHtml]);

  const handleClose = () => {
    const isDirty = currentHtml !== originalHtmlRef.current;
    if (isDirty) {
      if (window.confirm("You have unsaved changes. Are you sure you want to discard them?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  const handleSave = () => {
    onSave(sectionKey, currentHtml);
    onClose();
  };

  const handleReset = () => {
    const isDirty = currentHtml !== originalHtmlRef.current;
    if (isDirty) {
      if (window.confirm("You have unsaved changes. Are you sure you want to reset to the auto-generated content and lose your edits?")) {
        onReset(sectionKey);
        onClose();
      }
    } else {
       if (window.confirm("Are you sure you want to reset this section to the auto-generated content?")) {
        onReset(sectionKey);
        onClose();
      }
    }
  };

  return (
    <dialog ref={dialogRef} onClose={handleClose}>
      <h2>Editing: {label}</h2>
      <textarea
        value={currentHtml}
        onChange={(e) => setCurrentHtml(e.target.value)}
        rows={15}
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      <div>
        <button onClick={handleClose}>Cancel</button>
        <button onClick={handleReset} disabled={!isOverridden}>
          Reset to Auto-Generated
        </button>
        <button onClick={handleSave}>Save</button>
      </div>
    </dialog>
  );
}
