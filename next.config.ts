import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * Next's App Router needs `'unsafe-inline'` for styles (styled-jsx and inline
 * style attributes, which the stage relies on for per-element geometry), and
 * `'unsafe-eval'` only in development for React Refresh. Scripts in production
 * are limited to this origin plus the strictly necessary inline bootstrap.
 *
 * `frame-src` is deliberately open: embed elements exist to show third-party
 * content, and each iframe carries its own restrictive sandbox attribute.
 */
const isDev = process.env.NODE_ENV === "development";

const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : "";
  } catch {
    return "";
  }
})();

const csp = [
  `default-src 'self'`,
  // `wasm-unsafe-eval` admits WebAssembly compilation only — not JS eval. The
  // camera background remover runs MediaPipe's segmenter on-device, and its
  // wasm runtime is served from this origin (public/mediapipe/).
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,
  // Stage media can be a remote https image, a signed Supabase URL, or a local
  // blob/data URL produced by an upload preview or a recording.
  `img-src 'self' data: blob: https:`,
  `media-src 'self' blob: https:`,
  `connect-src 'self' blob: ${supabaseOrigin} ${supabaseOrigin.replace("https://", "wss://")} https://*.supabase.co wss://*.supabase.co`,
  `frame-src https:`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  // Nothing may frame Captivate — presenter windows are same-origin popups.
  `frame-ancestors 'none'`,
  `upgrade-insecure-requests`,
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // Captivate needs camera, microphone and display capture on its own
            // origin, and nothing else.
            key: "Permissions-Policy",
            value: [
              "camera=(self)",
              "microphone=(self)",
              "display-capture=(self)",
              "fullscreen=(self)",
              "geolocation=()",
              "payment=()",
              "usb=()",
              "interest-cohort=()",
            ].join(", "),
          },
        ],
      },
      {
        // AI routes are per-request and expensive; never let anything cache
        // them. The asset route sets its own short private max-age instead,
        // so it is deliberately excluded from this rule.
        source: "/api/ai/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
