import { readFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // E2E builds use their own output dir so they don't clash with a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Android app bundles a static export (android/build.py sets this).
  ...(process.env.NEXT_STATIC_EXPORT === "1" ? { output: "export", trailingSlash: true } : {}),
  poweredByHeader: false,
  // Only the standalone marketing demo uses a subdirectory; Android stays at /.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  devIndicators: false,
};
export default nextConfig;
