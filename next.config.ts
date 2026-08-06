import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone" is incompatible with Vercel — only use for Docker/K8s
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
