import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  logging: {
    // Server actions receive the seller's Walmart Client ID and Secret as
    // arguments, and Next's dev server prints every server action call
    // with its arguments - i.e. the secret, in plaintext, in the terminal.
    serverFunctions: false,
  },
};

export default nextConfig;
