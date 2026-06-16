"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DISABLE_AUTH === "true") {
      router.replace("/");
    }
  }, [router]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoggingIn(true);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        // Set a cookie so middleware knows we are authed.
        // Firebase Auth is client-side, but middleware needs a cookie.
        // We set __session cookie (max-age 1 hour to match token).
        document.cookie = `__session=true; path=/; max-age=3600; SameSite=Lax`;
        
        const from = searchParams.get("from") || "/";
        router.replace(from);
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      setError(err.message || "Sign-in failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (process.env.NEXT_PUBLIC_DISABLE_AUTH === "true") {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-gray-200 p-8 space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-gray-900">N.E.R.D.</h1>
          <p className="text-gray-500 text-sm">NCADEMI EdTech Researcher for the Directory</p>
        </div>

        {error && (
          <div 
            role="alert" 
            className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded"
          >
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={isLoggingIn}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 
                     rounded-md px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 
                     focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isLoggingIn ? (
            "Signing in..."
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.712s.102-1.173.282-1.712V4.956H.957C.347 6.173 0 7.548 0 9s.347 2.827.957 4.044l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.454 0 2.333 2.043.957 4.956l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}
