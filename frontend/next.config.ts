import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep build tracing scoped to this app when other lockfiles exist above it.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
