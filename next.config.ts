import type { NextConfig } from "next";

// Static export for GitHub Pages: the whole app is client-rendered and
// persists to localStorage, so no Node server is required. GitHub Pages
// serves this as a project site under /shame-of-thrones/, hence basePath.
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/shame-of-thrones",
  images: { unoptimized: true },
};

export default nextConfig;
