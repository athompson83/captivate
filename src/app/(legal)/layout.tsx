import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";

/**
 * Prose pages, in the public site's chrome.
 *
 * Deliberately narrow: a reader who has arrived here wants one column of text
 * they can actually read, and the same header and footer as the page that sent
 * them, so it is obvious they have not left the product.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="marketing min-h-screen">
      <SiteHeader />
      <main className="shell py-14">
        <article className="prose-legal mx-auto max-w-[68ch]">{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
