import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The Qloo harness resolves files relative to import.meta.url (e.g. new URL("../../resources/", ...)),
  // which Turbopack cannot bundle; load it with Node's own resolver instead.
  serverExternalPackages: ["@qloo/qloo-harness"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
