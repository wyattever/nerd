"use client";

import { useState, useRef, useEffect } from "react";
import { USERS, fullName } from "@/lib/users";
import "../nerd-table.css";

export default function UsersPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const allSelected = selected.size === USERS.length && USERS.length > 0;
  const someSelected = selected.size > 0 && !allSelected;

  // `indeterminate` is a DOM property, not an HTML attribute, so React
  // cannot set it from JSX. It must be assigned imperatively.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  function toggleOne(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === USERS.length ? new Set() : new Set(USERS.map((u) => u.email))
    );
  }

  const selectionLabel =
    selected.size === 0
      ? "No users selected"
      : `${selected.size} of ${USERS.length} selected`;

  return (
    <div className="nerd-table-page">
      <a className="nerd-skip" href="#users-table">
        Skip to table
      </a>

      <header className="nerd-header">
        <p className="nerd-eyebrow">N.E.R.D.</p>
        <h1 className="nerd-title">Users</h1>
        <p className="nerd-subtitle">
          People with access to N.E.R.D. and the role each holds.
        </p>
      </header>

      <div className="nerd-toolbar" role="group" aria-label="Table actions">
        <span className="nerd-toolbar-label">Actions</span>
        <button type="button" className="nerd-btn" disabled aria-describedby="users-actions-note">
          Add user
        </button>
        <button type="button" className="nerd-btn" disabled aria-describedby="users-actions-note">
          Edit roles
        </button>
        <button
          type="button"
          className="nerd-btn nerd-btn--danger"
          disabled
          aria-describedby="users-actions-note"
        >
          Delete user
        </button>
        <p id="users-actions-note" className="nerd-visually-hidden">
          Not yet available. Selection works, but these actions are placeholders
          with no data source connected.
        </p>
        <span className="nerd-count">
          {USERS.length} {USERS.length === 1 ? "user" : "users"}
        </span>
      </div>

      {/* Selection changes are announced here (WCAG 4.1.3). Errors would
          render into a separate role="alert" container, not this one. */}
      <div
        id="users-status"
        role="status"
        aria-live="polite"
        className="nerd-visually-hidden"
      >
        {selectionLabel}
      </div>

      {/* tabIndex={0} keeps the region keyboard-operable if it ever needs to
          scroll (WCAG 2.1.1); role and aria-label give it a name. */}
      <div
        className="nerd-table-region"
        id="users-table"
        role="region"
        aria-label="Users"
        tabIndex={0}
      >
        <table className="nerd-table">
          <caption className="nerd-caption">
            Users — {USERS.length} records, 5 columns.
          </caption>

          <thead>
            <tr>
              <th scope="col" className="nerd-col-select">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="nerd-checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all users"
                />
              </th>
              <th scope="col" className="nerd-col-first">First</th>
              <th scope="col" className="nerd-col-last">Last</th>
              <th scope="col" className="nerd-col-email">Email</th>
              <th scope="col" className="nerd-col-role">Role</th>
            </tr>
          </thead>

          <tbody>
            {USERS.map((user) => {
              const isSelected = selected.has(user.email);
              return (
                <tr key={user.email} data-selected={isSelected}>
                  <td className="nerd-col-select">
                    <input
                      type="checkbox"
                      className="nerd-checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(user.email)}
                      aria-label={`Select ${fullName(user)}`}
                    />
                  </td>
                  <td className="nerd-col-first">{user.first}</td>
                  <td>{user.last}</td>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
