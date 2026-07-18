import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@isotope/application",
    "@isotope/identity",
    "@isotope/kernel",
    "@isotope/preview",
    "@isotope/sandbox",
    "@isotope/workspace",
  ],
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
