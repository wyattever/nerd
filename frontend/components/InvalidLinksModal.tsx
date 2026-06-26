"use client";
import { useEffect, useRef, useState, useId } from "react";
import { InvalidLink, SectionKey } from "@/lib/types";

interface Props {
  links: InvalidLink[];
  vendorName: string;
  onClose: () => void;
  onApplyChanges: (toDelete: InvalidLink[]) => void;
  readOnly?: boolean;
  overriddenSections: SectionKey[];
}

// Group links by section label
function groupBySection(links: InvalidLink[]): Record<string, InvalidLink[]> {
  return links.reduce<Record<string, InvalidLink[]>>((acc, link) => {
    if (!acc[link.section]) acc[link.section] = [];
    acc[link.section].push(link);
    return acc;
  }, {});
}

export function InvalidLinksModal({ links, vendorName, onClose, onApplyChanges, readOnly = false, overriddenSections }: Props) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Focus the close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Trap focus inside modal
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab") {
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const linkKey = (link: InvalidLink) => `${link.section}::${link.url}`;

  const deletableLinks = links.filter(l => !overriddenSections.includes(l.sectionKey));
  const allKeys = deletableLinks.map(linkKey);
  const allChecked = allKeys.length > 0 && allKeys.every(k => checked.has(k));
  const someChecked = allKeys.some(k => checked.has(k)) && !allChecked;

  const handleSelectAll = () => {
    if (allChecked) {
      setChecked(new Set());
    } else {
      setChecked(new Set(allKeys));
    }
  };

  const handleToggle = (key: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleCopySelected = async () => {
    const selected = links.filter(l => checked.has(linkKey(l)));
    const text = selected.map(l => `${l.text} (${l.url})`).join("\n");
    await navigator.clipboard.writeText(text);
  };

  const handleApplyChanges = () => {
    const selectedToDelete = links.filter(l => checked.has(linkKey(l)));
    onApplyChanges(selectedToDelete);
    onClose();
  };

  const grouped = groupBySection(links);
  const hasLinks = links.length > 0;
  const hasSelection = checked.size > 0;

  // Select all checkbox ref for indeterminate state
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center
                 bg-black/50"
      aria-hidden="false"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative bg-white rounded-lg shadow-xl w-full max-w-[80%]
                   max-h-[85vh] flex flex-col mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4
                        border-b border-gray-200 flex-shrink-0">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            Link Management (Delete Only)
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close Link Management dialog"
            className="text-gray-500 hover:text-gray-700 focus:outline-none
                       focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                       rounded p-1"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"
              fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="2" y1="2" x2="14" y2="14" />
              <line x1="14" y1="2" x2="2" y2="14" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {!hasLinks ? (
            <p className="text-sm text-gray-700">
              No invalid links detected.
            </p>
          ) : (
            <>
              {/* Select All */}
              <div className="flex items-center gap-2 mb-4">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  id="select-all-invalid"
                  checked={allChecked}
                  onChange={handleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-blue-700
                             focus:ring-2 focus:ring-blue-500"
                />
                <label htmlFor="select-all-invalid"
                  className="text-sm font-medium text-gray-700 cursor-pointer">
                  Select all (deletable)
                </label>
              </div>

              {/* Grouped sections */}
              {Object.entries(grouped).map(([section, sectionLinks]) => (
                <section key={section} className="mb-4">
                  <h3 className="text-xs font-semibold text-gray-500
                                 uppercase tracking-wide mb-2">
                    {section}
                  </h3>
                  <ul className="space-y-2">
                    {sectionLinks.map((link) => {
                      const key = linkKey(link);
                      const inputId = `invalid-link-${key.replace(/[^a-z0-9]/gi, "-")}`;
                      const isOverridden = overriddenSections.includes(link.sectionKey);
                      return (
                        <li key={key} className={`flex flex-col gap-2 p-3 rounded border ${isOverridden ? 'bg-gray-100 border-gray-200' : 'bg-gray-50 border-gray-100'}`}>
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              id={inputId}
                              checked={checked.has(key)}
                              onChange={() => handleToggle(key)}
                              disabled={isOverridden}
                              className="mt-1 h-4 w-4 rounded border-gray-300
                                         text-blue-700 focus:ring-2
                                         focus:ring-blue-500 flex-shrink-0
                                         disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                            <div className="flex-1 min-w-0">
                              <label htmlFor={inputId} 
                                className={`text-sm font-medium cursor-pointer leading-snug block ${isOverridden ? 'text-gray-500 cursor-not-allowed' : 'text-gray-900'}`}>
                                {link.text}
                              </label>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" 
                                 className="text-xs text-blue-600 hover:underline break-all block mt-1">
                                {link.url}
                              </a>
                              {link.reason && (
                                <p className="text-xs font-semibold text-red-600 mt-1">
                                  Failure Reason: {link.reason}
                                </p>
                              )}
                              {isOverridden && (
                                <p className="text-xs font-semibold text-gray-600 mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                                  Edit this section to remove
                                </p>
                              )}
                            </div>
                          </div>
                          
                          {link.screenshot_path && (
                            <div className="mt-2 ml-6">
                              <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Evidence Snapshot</p>
                              <a href={link.screenshot_path} target="_blank" rel="noopener noreferrer">
                                <img 
                                  src={link.screenshot_path} 
                                  alt={`Screenshot of ${link.url}`}
                                  className="w-full max-h-40 object-cover object-top rounded border border-gray-200 hover:opacity-90 transition-opacity"
                                />
                              </a>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-col gap-2 px-6 py-4 border-t
                        border-gray-200 flex-shrink-0 bg-gray-50">
          <div className="flex gap-2">
            <button
              onClick={handleCopySelected}
              disabled={!hasSelection}
              aria-disabled={!hasSelection}
              className="flex-1 text-sm px-4 py-2 rounded border
                         border-gray-300 hover:bg-gray-100 focus:outline-none
                         focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                         disabled:opacity-40 disabled:cursor-not-allowed bg-white"
            >
              Copy Selected Broken
            </button>
            <button
              onClick={handleApplyChanges}
              disabled={readOnly || !hasSelection}
              aria-disabled={readOnly || !hasSelection}
              className="flex-[2] text-sm px-4 py-2 rounded bg-blue-700 text-white
                         hover:bg-blue-800 focus:outline-none font-medium
                         focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {readOnly ? "Apply Changes (Disabled — Read Only)" : `Delete Selected (${checked.size})`}
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full text-sm px-4 py-2 rounded border
                       border-gray-300 hover:bg-gray-100 focus:outline-none
                       focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 bg-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
