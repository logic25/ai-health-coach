import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ship the SQL migrations with the serverless bundle so /api/admin/setup
  // can initialize a fresh database after deploy
  outputFileTracingIncludes: {
    "/api/admin/setup": ["./src/db/migrations/**"],
  },
};

export default nextConfig;
