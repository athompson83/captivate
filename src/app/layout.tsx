import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/site";
import { Inter, Manrope, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { ReducedMotionProvider } from "@/components/ui/reduced-motion";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/*
 * Manrope is the brand kit's display face, and it replaced Fraunces — a serif
 * — when the kit arrived. The two say different things about the product: a
 * high-contrast serif is editorial, and Captivate is a spatial tool whose own
 * logotype is a geometric sans. Inter stays for interface and body copy, which
 * is what the kit asks for and what the app already did.
 */
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
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
 *
 * `alternates.canonical` is deliberately absent for the same reason `robots`
 * is. Next merges metadata by field, so a canonical set here is inherited by
 * every page that does not replace it — which was every indexable page except
 * the legal two, telling a crawler that `/pricing` and `/sign-up` are
 * duplicates of the landing page. A canonical is a per-route claim; it is set
 * on each route that makes it. `openGraph.url` is omitted for the same reason,
 * and the rest of the `openGraph` block is inherited on purpose because a site
 * name and a card type really are site-wide.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: "Captivate — presentations that move",
    template: "%s · Captivate",
  },
  description: DESCRIPTION,
  // The company's name belongs on the identity fields — the installed app, the
  // share card — and not in the tab title's template, where it would be
  // repeated after every page name a user has open.
  applicationName: "Captivate by Axtevi",
  openGraph: {
    type: "website",
    siteName: "Captivate by Axtevi",
    title: "Captivate — presentations that move",
    description: DESCRIPTION,
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
        className={`${inter.variable} ${manrope.variable} ${grotesk.variable} ${mono.variable} antialiased`}
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
