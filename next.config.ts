import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/security";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
