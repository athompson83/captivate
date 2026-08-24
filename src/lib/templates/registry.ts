import { composeScene } from "@/lib/editor/layouts";
import type { SceneContent, SceneLayout } from "@/lib/schema/presentation";
import type { LayoutContent } from "@/lib/editor/layouts";
import type { NarrativeShape } from "@/lib/schema/narrative";

/**
 * A small, genuinely useful template set.
 *
 * One fully-written worked example, then six templates that each solve a real
 * presentation shape, rather than a hundred variations on the same grid. The
 * structures seed a full narrative skeleton with prompts in place of lorem
 * ipsum, so the first thing a user sees is a structure worth editing; the
 * example is a finished talk, so they can see where the structures lead.
 */

export interface TemplateScene {
  title: string;
  layout: SceneLayout;
  content: LayoutContent;
  speakerNotes: string;
  /**
   * The movement this scene belongs to — one word for what this part of the
   * argument *does*. Consecutive scenes sharing one become a section, and the
   * room sees these names on the movement rail while the deck is presented.
   * A template without them produces a presentation with no shape to show.
   */
  movement: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  audience: string;
  themeId: string;
  scenes: TemplateScene[];
  /**
   * The argument this template recommends, not just how it looks.
   *
   * Weights rather than durations, so the same shape holds whether someone
   * asked for fifteen minutes or fifty. It is a starting point: every movement,
   * moment, role and duration remains editable once applied.
   */
  shape?: NarrativeShape;
}

export const TEMPLATES: Template[] = [
  {
    /**
     * The worked example: a finished talk, not a structure with prompts.
     *
     * Every other template hands the author scaffolding; this one hands them a
     * deck that is already *done* — written content, speakable notes, a real
     * narrative map — so the first thing a new user opens can show them what
     * finished looks like. The talk is about presenting, which means the deck
     * demonstrates the product's argument while making it.
     */
    id: "example",
    name: "Hold the room",
    description:
      "A finished ten-scene talk, fully written — open it to see what done looks like, then present it, print it, or pull it apart.",
    audience: "Anyone opening Captivate for the first time",
    themeId: "midnight",
    shape: [
      {
        label: "DRIFT",
        title: "The problem",
        purpose: "Name the thing every presenter has watched happen.",
        weight: 1,
        moments: [
          {
            title: "The room leaves early",
            role: "hook",
            purpose: "Start inside a failure the audience has lived from both sides.",
            takeaway: "Losing the room is normal, not a personal flaw.",
            visualIntent: "statement",
            weight: 1,
          },
          {
            title: "When attention goes",
            role: "evidence",
            purpose: "Show the shape of drifting attention rather than assert it.",
            takeaway: "Attention decays on a curve, and the slide reel feeds the curve.",
            visualIntent: "data",
            weight: 1,
          },
        ],
      },
      {
        label: "CAMERA",
        title: "The idea",
        purpose: "Replace the slide reel with a camera over one canvas.",
        weight: 1.4,
        moments: [
          {
            title: "An argument is a place",
            role: "reframe",
            purpose: "State the central idea everything else hangs off.",
            takeaway: "Show people where they are, not just what is next.",
            visualIntent: "statement",
            weight: 1,
          },
          {
            title: "What a camera changes",
            role: "claim",
            purpose: "Make the reframe concrete in three claims.",
            takeaway: "Travel carries meaning a cut never can.",
            visualIntent: "enumeration",
            weight: 1,
          },
        ],
      },
      {
        label: "PROOF",
        title: "Why it holds",
        purpose: "Ground the idea in what rooms actually respond to.",
        weight: 1.2,
        moments: [
          {
            title: "Three things the room keeps",
            role: "evidence",
            purpose: "Name what survives the talk when the deck had a shape.",
            takeaway: "Place, order and pace are what memory hangs on to.",
            visualIntent: "enumeration",
            weight: 1,
          },
          {
            title: "Spending attention on purpose",
            role: "contrast",
            purpose: "Set the things that keep a room against the things that cost one.",
            takeaway: "Attention is a budget, and most decks spend it by accident.",
            visualIntent: "comparison",
            weight: 1,
          },
        ],
      },
      {
        label: "CRAFT",
        title: "Doing it",
        purpose: "Turn the idea into the way a talk gets built.",
        weight: 1.2,
        moments: [
          {
            title: "Build in movements",
            role: "application",
            purpose: "Give the working method, in the order it is used.",
            takeaway: "Say what you are arguing before you make anything visible.",
            visualIntent: "sequence",
            weight: 1,
          },
          {
            title: "One idea per scene",
            role: "synthesis",
            purpose: "Compress the craft into a rule that survives the talk.",
            takeaway: "If a scene needs two ideas, it is two scenes.",
            visualIntent: "statement",
            weight: 0.8,
          },
        ],
      },
    ],
    scenes: [
      {
        title: "Title",
        layout: "title",
        content: {
          eyebrow: "A worked example",
          heading: "{{TITLE}}",
          subheading: "Why attention drifts — and the shape of a talk that keeps it.",
        },
        speakerNotes:
          "Welcome. This talk is itself the demonstration: every scene you're about to see sits on one canvas, and we'll travel between them rather than flip through them. By the end you'll have seen the whole argument laid out as a place — and that's the point I'm going to make.",
        movement: "OPEN",
      },
      {
        title: "The room leaves early",
        layout: "statement",
        content: {
          heading: "Ten minutes in, half the room",
          headingAccent: "is somewhere else.",
        },
        speakerNotes:
          "You've sat in that room. Slide fourteen of forty, and you've quietly opened your email. Nobody decided to stop listening — attention just drained away, one identical slide at a time. This isn't a character flaw in audiences. It's a design flaw in the format.",
        movement: "DRIFT",
      },
      {
        title: "When attention goes",
        layout: "chart",
        content: {
          heading: "Attention doesn't fail — it drains",
          chart: {
            chart: "line",
            data: [
              { label: "Min 0", value: 95 },
              { label: "Min 5", value: 80 },
              { label: "Min 10", value: 55 },
              { label: "Min 20", value: 40 },
              { label: "Min 40", value: 30 },
            ],
            summary:
              "Attention starts near full, drops steeply through the first ten minutes, and settles low for the rest of the hour.",
          },
          caption: "Illustrative curve — the shape every lecturer recognises from the podium.",
        },
        speakerNotes:
          "This curve is illustrative, not a measurement — but you recognise it, because you've watched it happen from the front of the room. The steep part is the first ten minutes. Whatever you do about attention has to happen there, and a reel of look-alike slides is exactly the wrong tool for it.",
        movement: "DRIFT",
      },
      {
        title: "The idea",
        layout: "section",
        content: { eyebrow: "The idea", heading: "Stop flipping. Start travelling." },
        speakerNotes:
          "Here's the turn. Watch what the screen just did — we moved. You saw where that last idea sat and where this one begins. That feeling of arriving somewhere is what the next few scenes are about.",
        movement: "CAMERA",
      },
      {
        title: "An argument is a place",
        layout: "statement",
        content: {
          heading: "An argument is a place.",
          headingAccent: "Show people where they are.",
        },
        speakerNotes:
          "This is the whole idea in one sentence. A good talk has a geography: the problem lives over here, the evidence next to it, the answer across the map. Slides destroy that geography by showing one rectangle at a time. A camera over one canvas keeps it — the room always knows where it is inside the argument.",
        movement: "CAMERA",
      },
      {
        title: "What a camera changes",
        layout: "bullets",
        content: {
          heading: "What travel does that a cut can't",
          bullets: [
            "Distance carries meaning — a detail sits inside its context, an aside sits off to the side",
            "Arrival resets attention — motion tells the room something new is starting",
            "The map persists — pulling back shows the whole argument, any time you need it",
          ],
        },
        speakerNotes:
          "Three concrete things. First: where a scene sits says what it means — when we zoom into a detail, you see it's a detail of something. Second: every flight is a soft reset of the room's attention; movement is the oldest attention cue there is. Third: at any point I can pull back — press O and the whole argument appears — and everyone re-orients in a second.",
        movement: "CAMERA",
      },
      {
        title: "Three things the room keeps",
        layout: "three-up",
        content: {
          heading: "What people actually remember",
          cards: [
            {
              title: "Place",
              body: "Ideas get remembered by where they happened — beside, inside, after.",
              icon: "target",
            },
            {
              title: "Order",
              body: "A visible route from problem to answer is a story the room can retell.",
              icon: "arrow_right",
            },
            {
              title: "Pace",
              body: "Long flights for big turns, short hops for details — rhythm the room can feel.",
              icon: "clock",
            },
          ],
        },
        speakerNotes:
          "Ask someone what they remember from a great talk a month later. It's rarely a bullet point. It's the shape: there was a problem, it turned here, it landed there. Place, order and pace are the three handles memory actually grips — and all three are things a canvas has and a reel doesn't.",
        movement: "PROOF",
      },
      {
        title: "Spending attention on purpose",
        layout: "two-column",
        content: {
          heading: "Attention is a budget",
          bullets: [
            "One idea, stated large",
            "A move that means something",
            "A pause on the map",
          ],
          bulletsB: [
            "Six bullets read aloud",
            "A transition for its own sake",
            "Slide 23 of 60",
          ],
        },
        speakerNotes:
          "Left column: things that buy attention. Right column: things that spend it. Every element on screen is a withdrawal from the same account. The discipline isn't decoration — it's deciding, for every scene, what the one thing worth paying for is.",
        movement: "PROOF",
      },
      {
        title: "Build in movements",
        layout: "bullets",
        content: {
          heading: "How this deck was built",
          bullets: [
            "Say what you're arguing — each movement gets a one-word job",
            "Give every moment a takeaway the room should leave with",
            "Only then generate scenes — and place them so the layout is the argument",
            "Rehearse the travel: the flights are the transitions",
          ],
        },
        speakerNotes:
          "This is the working order, and it's the order this very deck was written in. The map came first — movements, moments, takeaways. The scenes were generated from the map, then placed so that the geography means something. If you open this deck in the editor, the narrative view shows you that map, still editable.",
        movement: "CRAFT",
      },
      {
        title: "One idea per scene",
        layout: "quote",
        content: {
          quote: "If a scene needs two ideas, it is two scenes.",
          attribution: "The only layout rule in this deck",
        },
        speakerNotes:
          "The one rule that survives contact with any topic. Scenes are cheap here — the canvas is infinite. Splitting an overloaded scene costs nothing and buys a cleaner flight, a clearer beat, and a map that reads honestly.",
        movement: "CRAFT",
      },
      {
        title: "Close",
        layout: "closing",
        content: {
          heading: "The room follows the camera.",
          subheading: "Give it somewhere worth going. Press O to see the whole argument.",
        },
        speakerNotes:
          "Pull back one last time — there's the whole talk, every idea in its place. That view is the argument for the product: you just watched a room-sized idea get laid out as a place and travelled. Now open the editor and pull this deck apart, or start your own map.",
        movement: "CLOSE",
      },
    ],
  },
  {
    id: "lecture",
    shape: [
      {
        label: "OPEN",
        title: "Why this matters",
        purpose: "Give the room a reason to care before any content arrives.",
        weight: 1,
        moments: [
          {
            title: "The situation they recognise",
            role: "hook",
            purpose: "Start inside something the audience has already lived.",
            takeaway: "This is about my work, not somebody else's.",
            visualIntent: "statement",
            weight: 1,
          },
          {
            title: "What you'll be able to do",
            role: "frame",
            purpose: "Set the contract for the session.",
            takeaway: "I know what I am expected to be able to do afterwards.",
            visualIntent: "enumeration",
            weight: 1,
          },
        ],
      },
      {
        label: "FRAME",
        title: "The core idea",
        purpose: "Replace the working mental model with a better one.",
        weight: 1.4,
        moments: [
          {
            title: "The idea in one sentence",
            role: "claim",
            purpose: "State the thing everything else hangs off.",
            takeaway: "I could repeat the central idea to someone else.",
            visualIntent: "statement",
            weight: 1,
          },
          {
            title: "How it actually works",
            role: "reframe",
            purpose: "Walk the mechanism rather than assert the conclusion.",
            takeaway: "I understand why it works, not just that it does.",
            visualIntent: "sequence",
            weight: 1.5,
          },
        ],
      },
      {
        label: "EVIDENCE",
        title: "Why you should believe it",
        purpose: "Ground the claim in something checkable.",
        weight: 1.3,
        moments: [
          {
            title: "What the evidence shows",
            role: "evidence",
            purpose: "Show the data behind the claim, not a summary of it.",
            takeaway: "The claim is supported, and I have seen the support.",
            visualIntent: "data",
            weight: 1,
          },
          {
            title: "A case worth walking through",
            role: "example",
            purpose: "Make it concrete with one real situation.",
            takeaway: "I can picture this happening.",
            visualIntent: "demonstration",
            weight: 1.2,
          },
        ],
      },
      {
        label: "CLOSE",
        title: "What to carry out",
        purpose: "Turn understanding into something they do differently.",
        weight: 0.8,
        moments: [
          {
            title: "The one thing to remember",
            role: "close",
            purpose: "Land a single idea rather than a summary of everything.",
            takeaway: "If I remember nothing else, I remember this.",
            visualIntent: "statement",
            weight: 1,
          },
        ],
      },
    ],
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
        speakerNotes: "Welcome the room. Say what you'll cover and why it matters to them today.",
        movement: "OPEN",
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
        movement: "OPEN",
      },
      {
        title: "The core idea",
        layout: "statement",
        content: {
          heading: "State the single most important idea",
          headingAccent: "in one sentence.",
        },
        speakerNotes: "Pause after this. Let it land before you explain it.",
        movement: "FRAME",
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
        movement: "FRAME",
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
        movement: "EVIDENCE",
      },
      {
        title: "Common mistakes",
        layout: "three-up",
        content: {
          heading: "Three things people get wrong",
          cards: [
            {
              title: "Mistake one",
              body: "Why it happens and what it costs.",
              icon: "alert-triangle",
            },
            {
              title: "Mistake two",
              body: "The tempting shortcut that fails.",
              icon: "alert-triangle",
            },
            {
              title: "Mistake three",
              body: "The detail that gets skipped.",
              icon: "alert-triangle",
            },
          ],
        },
        speakerNotes: "These are the exam and real-world failure points.",
        movement: "EVIDENCE",
      },
      {
        title: "Recap",
        layout: "closing",
        content: {
          heading: "What to take away",
          subheading: "Three sentences they should still remember next week.",
        },
        speakerNotes: "Close the loop back to the objectives slide.",
        movement: "CLOSE",
      },
    ],
  },
  {
    id: "pitch",
    shape: [
      {
        label: "PROBLEM",
        title: "The problem, felt",
        purpose: "Make the cost of the status quo real before offering relief.",
        weight: 1,
        moments: [
          {
            title: "The problem in their words",
            role: "provocation",
            purpose: "Name the pain the way the audience would name it.",
            takeaway: "They understand my problem better than I expected.",
            visualIntent: "statement",
            weight: 1,
          },
          {
            title: "What it costs today",
            role: "evidence",
            purpose: "Quantify the status quo so the change has a size.",
            takeaway: "Doing nothing is not free.",
            visualIntent: "data",
            weight: 1,
          },
        ],
      },
      {
        label: "INSIGHT",
        title: "What everyone gets wrong",
        purpose: "Earn the right to a different answer.",
        weight: 1.1,
        moments: [
          {
            title: "The assumption to drop",
            role: "reframe",
            purpose: "Overturn the belief that keeps the problem in place.",
            takeaway: "The obvious approach is why this has not been solved.",
            visualIntent: "comparison",
            weight: 1,
          },
        ],
      },
      {
        label: "PROOF",
        title: "Why this works",
        purpose: "Show the answer working rather than assert it.",
        weight: 1.4,
        moments: [
          {
            title: "The approach",
            role: "claim",
            purpose: "State what is being proposed, plainly.",
            takeaway: "I could explain the proposal to a colleague.",
            visualIntent: "statement",
            weight: 1,
          },
          {
            title: "Someone it worked for",
            role: "example",
            purpose: "One concrete case beats three abstractions.",
            takeaway: "This has worked somewhere real.",
            visualIntent: "demonstration",
            weight: 1.2,
          },
        ],
      },
      {
        label: "ASK",
        title: "What happens next",
        purpose: "Make the decision easy to say yes to.",
        weight: 0.7,
        moments: [
          {
            title: "The ask",
            role: "close",
            purpose: "Say exactly what is being asked for and what follows.",
            takeaway: "I know what I am being asked to decide.",
            visualIntent: "statement",
            weight: 1,
          },
        ],
      },
    ],
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
        movement: "OPEN",
      },
      {
        title: "Problem",
        layout: "statement",
        content: { heading: "Name the problem", headingAccent: "in the customer's own words." },
        speakerNotes: "Make them feel the pain before you offer relief.",
        movement: "PROBLEM",
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
        movement: "INSIGHT",
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
        movement: "SOLUTION",
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
        movement: "PROOF",
      },
      {
        title: "The ask",
        layout: "closing",
        content: { heading: "The ask", subheading: "How much, for what, over what period." },
        speakerNotes: "Be specific. Vagueness here reads as uncertainty.",
        movement: "ASK",
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
        movement: "OPEN",
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
        movement: "CONTEXT",
      },
      {
        title: "The turn",
        layout: "statement",
        content: { heading: "The moment", headingAccent: "the picture changes." },
        speakerNotes: "Pause here. This is the teaching point.",
        movement: "TURN",
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
        movement: "DECISION",
      },
      {
        title: "Outcome",
        layout: "bullets",
        content: {
          heading: "What actually happened",
          bullets: ["The decision made", "The result", "What the follow-up showed"],
        },
        speakerNotes: "Be honest about outcomes, including the uncomfortable ones.",
        movement: "OUTCOME",
      },
      {
        title: "Lesson",
        layout: "quote",
        content: {
          quote: "The one sentence you want them repeating to a colleague tomorrow.",
          attribution: "Take-home point",
        },
        speakerNotes: "End on the transferable principle, not the specifics.",
        movement: "LESSON",
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
        content: {
          eyebrow: "Workshop",
          heading: "{{TITLE}}",
          subheading: "Duration and what to bring.",
        },
        speakerNotes: "Housekeeping: breaks, materials, expectations.",
        movement: "OPEN",
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
        movement: "AGENDA",
      },
      {
        title: "Demonstration",
        layout: "media-full",
        content: {
          heading: "Watch first",
          caption: "Then you'll do it.",
          media: { url: "", alt: "" },
        },
        speakerNotes: "Narrate what you're doing and why, not just the steps.",
        movement: "DEMO",
      },
      {
        title: "Your turn",
        layout: "statement",
        content: { heading: "Your turn — 20 minutes, in pairs." },
        speakerNotes: "Circulate. Look for the specific error you predicted.",
        movement: "PRACTICE",
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
        movement: "CLOSE",
      },
    ],
  },
  {
    id: "report",
    shape: [
      {
        label: "FINDINGS",
        title: "What you need to know",
        purpose: "Lead with the finding, not the method.",
        weight: 0.8,
        moments: [
          {
            title: "The headline finding",
            role: "claim",
            purpose: "State the conclusion first; this audience is busy.",
            takeaway: "I have the answer in the first thirty seconds.",
            visualIntent: "statement",
            weight: 1,
          },
        ],
      },
      {
        label: "EVIDENCE",
        title: "What the data shows",
        purpose: "Support the finding with what was actually measured.",
        weight: 1.6,
        moments: [
          {
            title: "The numbers",
            role: "evidence",
            purpose: "Show the measurement behind the headline.",
            takeaway: "I have seen the evidence, not a summary of it.",
            visualIntent: "data",
            weight: 1,
          },
          {
            title: "How to read it",
            role: "context",
            purpose: "Say what the figures do and do not support.",
            takeaway: "I know how much weight this can carry.",
            visualIntent: "comparison",
            weight: 1,
          },
        ],
      },
      {
        label: "RISK",
        title: "What could be wrong",
        purpose: "Name the weaknesses before somebody else does.",
        weight: 0.8,
        moments: [
          {
            title: "What would change the conclusion",
            role: "contrast",
            purpose: "State the conditions under which this is wrong.",
            takeaway: "I know what would make this conclusion fail.",
            visualIntent: "enumeration",
            weight: 1,
          },
        ],
      },
      {
        label: "NEXT",
        title: "The decision",
        purpose: "Convert the finding into a decision.",
        weight: 0.8,
        moments: [
          {
            title: "What to do about it",
            role: "application",
            purpose: "Give the decision and its owner.",
            takeaway: "I know what happens next and who does it.",
            visualIntent: "enumeration",
            weight: 1,
          },
        ],
      },
    ],
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
        movement: "OPEN",
      },
      {
        title: "Headline",
        layout: "statement",
        content: { heading: "The finding, stated as a conclusion — not a topic." },
        speakerNotes: "Lead with the answer. Detail follows for those who want it.",
        movement: "FINDINGS",
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
        movement: "EVIDENCE",
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
        movement: "RISK",
      },
      {
        title: "Recommendation",
        layout: "closing",
        content: { heading: "Recommendation", subheading: "What to do, by when, and who owns it." },
        speakerNotes: "One clear recommendation beats three hedged ones.",
        movement: "NEXT",
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
        movement: "OPEN",
      },
    ],
  },
];

/** Materialise a template's scenes, substituting the user's chosen title. */
export function buildTemplateScenes(
  template: Template,
  title: string,
): { title: string; content: SceneContent; speakerNotes: string; movement: string }[] {
  const safeTitle = title.trim() || "Untitled presentation";

  return template.scenes.map((scene) => {
    const content: LayoutContent = { ...scene.content };
    if (content.heading === "{{TITLE}}") content.heading = safeTitle;
    return {
      title: scene.title,
      content: composeScene(scene.layout, content),
      speakerNotes: scene.speakerNotes,
      movement: scene.movement,
    };
  });
}

/**
 * The movements a template's scenes fall into, in order.
 *
 * Consecutive scenes sharing a movement form one — so a template can return to
 * an earlier idea without the two stretches being merged into one section that
 * spans the middle of the deck.
 */
export function templateMovements(
  scenes: { movement: string }[],
): { label: string; start: number; end: number }[] {
  const out: { label: string; start: number; end: number }[] = [];
  scenes.forEach((scene, index) => {
    const current = out[out.length - 1];
    if (current && current.label === scene.movement) {
      current.end = index + 1;
      return;
    }
    out.push({ label: scene.movement, start: index, end: index + 1 });
  });
  return out.filter((movement) => movement.label.length > 0);
}

export function getTemplate(id: string | null | undefined): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
