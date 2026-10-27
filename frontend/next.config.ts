import type { NextConfig } from "next";

// Static export served by FastAPI on port 8000 (PLAN §3, §11).
// No rewrites: they are unsupported with `output: "export"` (D-13).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
