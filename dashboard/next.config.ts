import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const imageHosts = [
  "s4.anilist.co",
  "cdn.myanimelist.net",
  "images.igdb.com",
  "image.tmdb.org",
  "cdn.discordapp.com",
  "media.discordapp.net",
];

const csp = [
  "default-src 'self'",
  // Script inline do tema (anti-flash) e do runtime do Next; nonce fica para fase posterior.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${imageHosts.map((h) => `https://${h}`).join(" ")}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://discord.com",
  "object-src 'none'",
].join("; ");

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const allowedOrigins = [
  "localhost:3000",
  ...(appUrl ? [new URL(appUrl).host] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: import.meta.dirname },
  poweredByHeader: false,
  images: {
    remotePatterns: imageHosts.map((hostname) => ({ protocol: "https" as const, hostname })),
  },
  experimental: {
    serverActions: { allowedOrigins },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;