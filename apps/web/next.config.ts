import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@pulsar/shared",
    "@pulsar/session-registry-bindings",
    "@pulsar/slow-tictactoe-bindings",
  ],
};

export default nextConfig;
