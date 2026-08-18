/**
 * Shared user directory for N.E.R.D.
 *
 * Consumed by the /users table, by the /researcher table to render Gatherer
 * and Reviewer as names, and by any form that assigns them. Hardcoded for
 * now; this is the single place to change when it moves behind an API.
 */

export type UserRole = "Admin" | "Researcher";

export interface User {
  first: string;
  last: string;
  email: string;
  role: UserRole;
}

export const USERS: User[] = [
  { first: "Rob", last: "Carr", email: "r.carr@usu.edu", role: "Admin" },
  { first: "Mindy", last: "Johnson", email: "mindy.johnson@usu.edu", role: "Researcher" },
  { first: "George", last: "Joeckel", email: "g.joeckel@usu.edu", role: "Researcher" },
];

/**
 * Display name for a user. Kept as a helper rather than a stored field so
 * first/last remain the single source of truth and the two cannot drift.
 * Change the convention here (e.g. to "Last, First") and every consumer
 * follows.
 */
export function fullName(user: User): string {
  return `${user.first} ${user.last}`;
}

/** Find a user by email address. Case-insensitive. */
export function userByEmail(email: string | null | undefined): User | undefined {
  if (!email) return undefined;
  const needle = email.trim().toLowerCase();
  return USERS.find((u) => u.email.toLowerCase() === needle);
}

/**
 * Render a stored email as a display name.
 *
 * Falls back to the raw value when the email is not in the directory —
 * showing an unrecognized address is honest, whereas rendering it blank
 * would silently hide real data.
 */
export function displayName(email: string | null | undefined): string {
  if (!email) return "";
  const user = userByEmail(email);
  return user ? fullName(user) : email;
}
