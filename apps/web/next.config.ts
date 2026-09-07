import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pulsar/shared"],
};

export default nextConfig;
