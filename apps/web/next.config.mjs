/** @type {import('next').NextConfig} */
const nextConfig = {
  // A second dev server (for testing on a copy of the data) sets its own
  // build folder so the two never overwrite each other's cache.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      bodySizeLimit: "1mb", // files go straight to storage
    },
    // Native or server-only packages that must not be bundled.
    serverComponentsExternalPackages: ["@node-rs/argon2", "mongodb", "ioredis", "nodemailer"],
  },
};

export default nextConfig;
