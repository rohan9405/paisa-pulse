/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // E2E builds use their own output dir so they don't clash with a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Android app bundles a static export (android/build.py sets this).
  ...(process.env.NEXT_STATIC_EXPORT === "1" ? { output: "export", trailingSlash: true } : {}),
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
