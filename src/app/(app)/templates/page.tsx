import type { Metadata } from "next";
import { TEMPLATES } from "@/lib/templates/registry";
import { getTheme } from "@/lib/schema/theme";
import { composeScene } from "@/lib/editor/layouts";
import { TemplateGallery } from "@/components/dashboard/template-gallery";

export const metadata: Metadata = { title: "Templates" };

export default function TemplatesPage() {
  // Rendered server-side from the same composition engine the editor uses, so
  // a template preview is exactly what the user will get.
  const previews = TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    audience: template.audience,
    themeId: template.themeId,
    sceneCount: template.scenes.length,
    scenes: template.scenes.slice(0, 3).map((scene) => ({
      title: scene.title,
      content: composeScene(scene.layout, {
        ...scene.content,
        heading: scene.content.heading === "{{TITLE}}" ? template.name : scene.content.heading,
      }),
    })),
    theme: getTheme(template.themeId),
  }));

  return <TemplateGallery templates={previews} />;
}
