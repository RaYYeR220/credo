import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app (a stray lockfile in the home dir confused inference).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
