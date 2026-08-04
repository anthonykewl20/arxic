/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3'],
  async rewrites() {
    return [
      { source: '/__arxic/seed', destination: '/api/__arxic/seed' },
      { source: '/__arxic/reset', destination: '/api/__arxic/reset' },
    ];
  },
};

export default nextConfig;
