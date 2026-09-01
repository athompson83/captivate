import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/site";
import { Inter, Fraunces, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { ReducedMotionProvider } from "@/components/ui/reduced-motion";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const DESCRIPTION =
  "Create immersive, animated presentations — then present, annotate and record them from one place.";

/**
 * `robots` is deliberately absent here.
 *
 * It used to say `index: false` for every route in the application, which is
 * the safe default while a product is being built and the wrong one the moment
 * it has a front door: it made the landing page, the pricing page and the
 * sign-up path invisible to search, so nobody could arrive. Indexing is now
 * decided per route — the two private layouts and every link-addressed page
 * opt out explicitly, and `robots.ts` disallows the same prefixes — which
 * means a new route is indexable unless it says otherwise. That is the right
 * default for a public product, and the reason `PRIVATE_PATH_PREFIXES` exists
 * as one list rather than a habit.
 *
 * `metadataBase` resolves every canonical and social URL against the origin
 * this deployment was configured with, so a Preview build cannot advertise
 * itself as the canonical copy.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "Captivate — presentations that move",
    template: "%s · Captivate",
  },
  description: DESCRIPTION,
  applicationName: "Captivate",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Captivate",
    title: "Captivate — presentations that move",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Captivate — presentations that move",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBF9F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1117" },
  ],
  width: "device-width",
  initialScale: 1,
  // The editor and stage rely on precise pointer geometry; zooming breaks it.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before first paint so the app never flashes the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('captivate-theme');var d=s==='dark'||s===null||(s==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${fraunces.variable} ${grotesk.variable} ${mono.variable} antialiased`}
      >
        <ReducedMotionProvider>
          <ThemeProvider>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </ReducedMotionProvider>
      </body>
    </html>
  );
}
