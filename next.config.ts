import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Build errors are NOT ignored — fix them instead of hiding them. */
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: '**.public.blob.vercel-storage.com' },
    ],
  },
  // Older portal URLs now live inside the unified staff console.
  async redirects() {
    return [
      { source: '/front-desk', destination: '/admin/front-desk', permanent: false },
      { source: '/front-desk/:path*', destination: '/admin/front-desk', permanent: false },
      { source: '/housekeeping', destination: '/admin/housekeeping', permanent: false },
      { source: '/agent', destination: '/admin/agent', permanent: false },
      { source: '/owner', destination: '/admin/dashboard', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
