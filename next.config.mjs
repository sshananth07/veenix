/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second dev server (for testing on a copy of the data) sets its own
  // build folder so the two never overwrite each other's cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
