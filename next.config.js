/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  env: {
    FIREBASE_WEB_CONFIG: process.env.FIREBASE_WEB_CONFIG,
    GFU_DASH_PRIMARY_ADMIN_EMAIL: process.env.GFU_DASH_PRIMARY_ADMIN_EMAIL
  }
};
module.exports = nextConfig;
