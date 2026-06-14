import path from 'path';

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
