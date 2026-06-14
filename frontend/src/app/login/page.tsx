'use client';

import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center min-h-screen">
        <p className="text-gray-500">Loading authentication...</p>
      </div>
    }>
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <LoginForm />
      </div>
    </Suspense>
  );
}