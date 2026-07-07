// lib/api.ts
import { getIdToken } from "./firebase";

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = await getIdToken();
  
  const headers = {
    ...options.headers,
    "Authorization": token ? `Bearer ${token}` : "",
    "Content-Type": "application/json",
  };

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}