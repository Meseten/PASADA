/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Every route is exported as its own folder (dashboard/index.html), so the
  // Tauri asset resolver finds dashboard.html directly. Without this the
  // webview asks for the extensionless asset and only a fallback saves it,
  // which is what bricked the app after a webview reload.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
}

module.exports = nextConfig