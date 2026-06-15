import path from 'path';

// Phase 4 Hardening: Production Build Safety Guard
// NEXT_PUBLIC_ variables are inlined at build time. We must ensure the local 
// bypass flag is NEVER true in a production build artifact.
if (
  process.env.NODE_ENV === 'production' && 
  process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true'
) {
  throw new Error(
    'SECURITY FAULT: NEXT_PUBLIC_DISABLE_AUTH bypass detected in a production build environment. Aborting.'
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // REMOVED undici, firebase from here to resolve the conflict
  transpilePackages: [], 
  output: 'standalone',
  experimental: {
    // These are now handled strictly on the server side
    serverComponentsExternalPackages: ['undici', 'firebase']
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve('./src');
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/research/:path*',
        destination: 'http://localhost:8000/research/:path*',
      },
      {
        source: '/jobs/:path*',
        destination: 'http://localhost:8000/jobs/:path*',
      },
      {
        source: '/render',
        destination: 'http://localhost:8000/render',
      },
    ];
  },
};
export default nextConfig;
