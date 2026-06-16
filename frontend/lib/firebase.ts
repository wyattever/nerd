import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: "edtech-agent-2026.firebaseapp.com",
  projectId: "edtech-agent-2026",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth: Auth = getAuth(app);

/**
 * Gets the current Firebase ID token.
 * Returns null if auth is disabled for local development.
 * Otherwise returns the token or null if not signed in.
 */
export async function getIdToken(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_DISABLE_AUTH === "true") {
    return null;
  }

  // Ensure auth is initialized before checking currentUser
  await auth.authStateReady();

  if (auth.currentUser) {
    return auth.currentUser.getIdToken(true); // Force refresh to handle 1-hour expiry
  }

  return null;
}
