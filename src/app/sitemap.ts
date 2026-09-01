import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/**
 * The pages a stranger is meant to arrive on.
 *
 * Listed by hand rather than derived from the route tree, because "every route
 * that renders" and "every route worth finding in a search" are different sets
 * and only the first one can be computed. A deck behind a share link renders
 * perfectly well and belongs in neither.
 */
const PUBLIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "monthly" as const },
  { path: "/pricing", priority: 0.8, changeFrequency: "monthly" as const },
  { path: "/sign-up", priority: 0.5, changeFrequency: "yearly" as const },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const lastModified = new Date();

  return PUBLIC_ROUTES.map((route) => ({
    url: `${origin}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
