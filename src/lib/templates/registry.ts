import { composeScene } from "@/lib/editor/layouts";
import type { SceneContent, SceneLayout } from "@/lib/schema/presentation";
import type { LayoutContent } from "@/lib/editor/layouts";

/**
 * A small, genuinely useful template set.
 *
 * Six templates that each solve a real presentation shape, rather than a
 * hundred variations on the same grid. Each one seeds a full narrative
 * skeleton with prompts in place of lorem ipsum, so the first thing a user
 * sees is a structure worth editing.
 */

export interface TemplateScene {
  title: string;
  layout: SceneLayout;
  content: LayoutContent;
  speakerNotes: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  audience: string;
  themeId: string;
  scenes: TemplateScene[];
}

export const TEMPLATES: Template[] = [
  {
    id: "lecture",
    name: "Lecture",
    description: "Objectives, teaching blocks, a case, and a recap. Built for a 50-minute class.",
    audience: "Educators and trainers",
    themeId: "midnight",
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: {
          eyebrow: "Session 01",
          heading: "{{TITLE}}",
          subheading: "Add the course, date, or your name here.",
        },
        speakerNotes:
          "Welcome the room. Say what you'll cover and why it matters to them today.",
      },
      {
        title: "Learning objectives",
        layout: "bullets",
        content: {
          heading: "By the end of this session",
          bullets: [
            "Describe the core concept in your own words",
            "Recognise it in a real scenario",
            "Apply it to a decision under time pressure",
          ],
        },
        speakerNotes: "Read these aloud. They set the contract for the next 50 minutes.",
      },
      {
        title: "The core idea",
        layout: "statement",
        content: { heading: "State the single most important idea in one sentence." },
        speakerNotes: "Pause after this. Let it land before you explain it.",
      },
      {
        title: "How it works",
        layout: "split-right",
        content: {
          heading: "How it works",
          bullets: ["First mechanism", "Second mechanism", "What changes as a result"],
          media: { url: "", alt: "" },
        },
        speakerNotes: "Walk the diagram left to right. Don't read the bullets verbatim.",
      },
      {
        title: "Case",
        layout: "media-full",
        content: {
          heading: "A case to think through",
          caption: "Give just enough detail for a decision — not the whole chart.",
          media: { url: "", alt: "" },
        },
        speakerNotes: "Ask the room what they'd do before you reveal what happened.",
      },
      {
        title: "Common mistakes",
        layout: "three-up",
        content: {
          heading: "Three things people get wrong",
          cards: [
            { title: "Mistake one", body: "Why it happens and what it costs.", icon: "alert-triangle" },
            { title: "Mistake two", body: "The tempting shortcut that fails.", icon: "alert-triangle" },
            { title: "Mistake three", body: "The detail that gets skipped.", icon: "alert-triangle" },
          ],
        },
        speakerNotes: "These are the exam and real-world failure points.",
      },
      {
        title: "Recap",
        layout: "closing",
        content: {
          heading: "What to take away",
          subheading: "Three sentences they should still remember next week.",
        },
        speakerNotes: "Close the loop back to the objectives slide.",
      },
    ],
  },
  {
    id: "pitch",
    name: "Pitch",
    description: "Problem, insight, solution, proof, ask. The classic ten-minute investor arc.",
    audience: "Founders and sales teams",
    themeId: "signal",
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: { eyebrow: "2026", heading: "{{TITLE}}", subheading: "One line on what you do." },
        speakerNotes: "Say the one-liner out loud. Don't read the slide.",
      },
      {
        title: "Problem",
        layout: "statement",
        content: { heading: "Name the problem in the customer's own words." },
        speakerNotes: "Make them feel the pain before you offer relief.",
      },
      {
        title: "Why now",
        layout: "two-column",
        content: {
          heading: "Why now",
          bullets: ["What changed in the market", "What changed in the technology"],
          bulletsB: ["What that unlocks", "Why it wasn't possible before"],
        },
        speakerNotes: "Timing is the question every investor asks silently.",
      },
      {
        title: "Solution",
        layout: "split-left",
        content: {
          heading: "What we built",
          bullets: ["The core capability", "What it replaces", "Why it's defensible"],
          media: { url: "", alt: "" },
        },
        speakerNotes: "Show the product. One screenshot beats three bullets.",
      },
      {
        title: "Traction",
        layout: "chart",
        content: {
          heading: "Traction",
          chart: {
            chart: "column",
            data: [
              { label: "Q1", value: 12 },
              { label: "Q2", value: 28 },
              { label: "Q3", value: 61 },
              { label: "Q4", value: 118 },
            ],
            summary: "Quarterly growth from 12 to 118.",
          },
          caption: "Replace with your real numbers.",
        },
        speakerNotes: "State the number and the rate. Nothing else.",
      },
      {
        title: "The ask",
        layout: "closing",
        content: { heading: "The ask", subheading: "How much, for what, over what period." },
        speakerNotes: "Be specific. Vagueness here reads as uncertainty.",
      },
    ],
  },
  {
    id: "case-study",
    name: "Case study",
    description: "A single story told properly: context, turn, decision, outcome, lesson.",
    audience: "Clinical and professional educators",
    themeId: "ember",
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: { eyebrow: "Case", heading: "{{TITLE}}", subheading: "A short framing line." },
        speakerNotes: "Set the scene in one sentence.",
      },
      {
        title: "Presentation",
        layout: "split-right",
        content: {
          heading: "What you're handed",
          bullets: ["Initial findings", "What's immediately concerning", "What's missing"],
          media: { url: "", alt: "" },
        },
        speakerNotes: "Give them only what a clinician would have at this moment.",
      },
      {
        title: "The turn",
        layout: "statement",
        content: { heading: "The moment the picture changes." },
        speakerNotes: "Pause here. This is the teaching point.",
      },
      {
        title: "Decision",
        layout: "three-up",
        content: {
          heading: "Three reasonable options",
          cards: [
            { title: "Option A", body: "What it assumes, and the risk.", icon: "circle" },
            { title: "Option B", body: "What it assumes, and the risk.", icon: "circle" },
            { title: "Option C", body: "What it assumes, and the risk.", icon: "circle" },
          ],
        },
        speakerNotes: "Poll the room before revealing what was chosen.",
      },
      {
        title: "Outcome",
        layout: "bullets",
        content: {
          heading: "What actually happened",
          bullets: ["The decision made", "The result", "What the follow-up showed"],
        },
        speakerNotes: "Be honest about outcomes, including the uncomfortable ones.",
      },
      {
        title: "Lesson",
        layout: "quote",
        content: {
          quote: "The one sentence you want them repeating to a colleague tomorrow.",
          attribution: "Take-home point",
        },
        speakerNotes: "End on the transferable principle, not the specifics.",
      },
    ],
  },
  {
    id: "workshop",
    name: "Workshop",
    description: "Agenda, demonstration, hands-on blocks, and checkpoints with timings.",
    audience: "Trainers running practical sessions",
    themeId: "chalk",
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: { eyebrow: "Workshop", heading: "{{TITLE}}", subheading: "Duration and what to bring." },
        speakerNotes: "Housekeeping: breaks, materials, expectations.",
      },
      {
        title: "Agenda",
        layout: "bullets",
        content: {
          heading: "How we'll spend the time",
          bullets: [
            "00:00 — Framing and demonstration",
            "00:20 — Practice block one",
            "00:45 — Debrief and common errors",
            "01:00 — Practice block two",
          ],
        },
        speakerNotes: "Timings visible up front reduce anxiety in the room.",
      },
      {
        title: "Demonstration",
        layout: "media-full",
        content: { heading: "Watch first", caption: "Then you'll do it.", media: { url: "", alt: "" } },
        speakerNotes: "Narrate what you're doing and why, not just the steps.",
      },
      {
        title: "Your turn",
        layout: "statement",
        content: { heading: "Your turn — 20 minutes, in pairs." },
        speakerNotes: "Circulate. Look for the specific error you predicted.",
      },
      {
        title: "Checkpoint",
        layout: "three-up",
        content: {
          heading: "Before we move on",
          cards: [
            { title: "Can you", body: "First competency check.", icon: "check" },
            { title: "Can you", body: "Second competency check.", icon: "check" },
            { title: "Can you", body: "Third competency check.", icon: "check" },
          ],
        },
        speakerNotes: "Hands up. Don't move on until most of the room is confident.",
      },
    ],
  },
  {
    id: "report",
    name: "Report",
    description: "Findings-first structure for briefings and updates. Data before narrative.",
    audience: "Consultants and analysts",
    themeId: "clinical",
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: { eyebrow: "Briefing", heading: "{{TITLE}}", subheading: "Prepared for — date." },
        speakerNotes: "State the question this briefing answers.",
      },
      {
        title: "Headline",
        layout: "statement",
        content: { heading: "The finding, stated as a conclusion — not a topic." },
        speakerNotes: "Lead with the answer. Detail follows for those who want it.",
      },
      {
        title: "The numbers",
        layout: "chart",
        content: {
          heading: "What the data shows",
          chart: {
            chart: "bar",
            data: [
              { label: "Segment A", value: 42 },
              { label: "Segment B", value: 31 },
              { label: "Segment C", value: 18 },
            ],
            summary: "Segment A leads at 42, followed by B at 31 and C at 18.",
          },
          caption: "Source and period.",
        },
        speakerNotes: "Say what the chart means before describing what it shows.",
      },
      {
        title: "Implications",
        layout: "two-column",
        content: {
          heading: "What this means",
          bullets: ["Implication for the near term", "Implication for cost"],
          bulletsB: ["Implication for risk", "What we still don't know"],
        },
        speakerNotes: "Be explicit about the limits of the analysis.",
      },
      {
        title: "Recommendation",
        layout: "closing",
        content: { heading: "Recommendation", subheading: "What to do, by when, and who owns it." },
        speakerNotes: "One clear recommendation beats three hedged ones.",
      },
    ],
  },
  {
    id: "blank",
    name: "Blank",
    description: "One title scene and nothing else. Start from a clear stage.",
    audience: "Anyone who already knows the shape",
    themeId: "midnight",
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: { heading: "{{TITLE}}", subheading: "" },
        speakerNotes: "",
      },
    ],
  },
];

/** Materialise a template's scenes, substituting the user's chosen title. */
export function buildTemplateScenes(
  template: Template,
  title: string,
): { title: string; content: SceneContent; speakerNotes: string }[] {
  const safeTitle = title.trim() || "Untitled presentation";

  return template.scenes.map((scene) => {
    const content: LayoutContent = { ...scene.content };
    if (content.heading === "{{TITLE}}") content.heading = safeTitle;
    return {
      title: scene.title,
      content: composeScene(scene.layout, content),
      speakerNotes: scene.speakerNotes,
    };
  });
}

export function getTemplate(id: string | null | undefined): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
