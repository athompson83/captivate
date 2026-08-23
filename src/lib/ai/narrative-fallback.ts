import type { ProposedMap } from "./schemas";
import type { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";

/**
 * A narrative map without a language model.
 *
 * The create-with-AI path is never a dead end on a deployment with no key: the
 * author still gets a real, editable argument with a stated purpose and
 * takeaway for every beat. It is labelled in the interface as a structural
 * draft, because that is what it is — the shape is real, the wording is a
 * prompt to replace.
 *
 * The shapes below are argument forms, not a single opening-middle-close
 * skeleton reused for everything. Which one is chosen depends on what the
 * request looks like, so asking for a lecture and asking for a pitch do not
 * produce the same map with different words.
 */

interface Beat {
  title: string;
  role: NarrativeRole;
  purpose: string;
  takeaway: string;
  visualIntent: VisualIntent;
  weight?: number;
}

interface Shape {
  id: string;
  /** Words in a request that suggest this argument form. */
  cues: RegExp;
  movements: { label: string; title: string; purpose: string; weight: number; beats: Beat[] }[];
}

const TEACHING: Shape = {
  id: "teaching",
  cues: /\b(teach|lecture|course|class|student|training|train|workshop|curriculum|module|learn)\b/i,
  movements: [
    {
      label: "OPEN",
      title: "Why this matters",
      purpose: "Give the room a reason to care before any content arrives.",
      weight: 1,
      beats: [
        {
          title: "The situation they recognise",
          role: "hook",
          purpose: "Start inside something the audience has already lived.",
          takeaway: "This is about my work, not somebody else's.",
          visualIntent: "statement",
        },
        {
          title: "What you'll be able to do",
          role: "frame",
          purpose: "Set the contract for the session.",
          takeaway: "I know what I am expected to be able to do afterwards.",
          visualIntent: "enumeration",
        },
      ],
    },
    {
      label: "FRAME",
      title: "The core idea",
      purpose: "Replace the working mental model with a better one.",
      weight: 1.4,
      beats: [
        {
          title: "The idea in one sentence",
          role: "claim",
          purpose: "State the thing everything else hangs off.",
          takeaway: "I could repeat the central idea to someone else.",
          visualIntent: "statement",
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
      label: "PROVE",
      title: "Why you should believe it",
      purpose: "Ground the claim in something checkable.",
      weight: 1.3,
      beats: [
        {
          title: "What the evidence shows",
          role: "evidence",
          purpose: "Show the data behind the claim, not a summary of it.",
          takeaway: "The claim is supported, and I have seen the support.",
          visualIntent: "data",
        },
        {
          title: "A case worth walking through",
          role: "example",
          purpose: "Make it concrete with one real situation.",
          takeaway: "I can picture this happening.",
          visualIntent: "demonstration",
        },
      ],
    },
    {
      label: "APPLY",
      title: "What to do differently",
      purpose: "Turn understanding into a change in behaviour.",
      weight: 1,
      beats: [
        {
          title: "The three things to change",
          role: "application",
          purpose: "Name what to do differently from tomorrow.",
          takeaway: "I know exactly what to do next time.",
          visualIntent: "enumeration",
        },
        {
          title: "Where it breaks down",
          role: "contrast",
          purpose: "Mark the boundary so nobody over-applies it.",
          takeaway: "I know when this does not apply.",
          visualIntent: "comparison",
        },
      ],
    },
    {
      label: "CLOSE",
      title: "What to carry out",
      purpose: "Leave the room with the part that matters.",
      weight: 0.6,
      beats: [
        {
          title: "The one thing to remember",
          role: "close",
          purpose: "Land a single idea rather than a summary of everything.",
          takeaway: "If I remember nothing else, I remember this.",
          visualIntent: "statement",
        },
      ],
    },
  ],
};

const PERSUASION: Shape = {
  id: "persuasion",
  cues: /\b(pitch|invest|fund|propose|proposal|sell|client|board|budget|approve|buy|customer)\b/i,
  movements: [
    {
      label: "OPEN",
      title: "The problem, felt",
      purpose: "Make the cost of the status quo real before offering relief.",
      weight: 1,
      beats: [
        {
          title: "The problem in their words",
          role: "provocation",
          purpose: "Name the pain the way the audience would name it.",
          takeaway: "They understand my problem better than I expected.",
          visualIntent: "statement",
        },
        {
          title: "What it costs today",
          role: "evidence",
          purpose: "Quantify the status quo so the change has a size.",
          takeaway: "Doing nothing is not free.",
          visualIntent: "data",
        },
      ],
    },
    {
      label: "INSIGHT",
      title: "What everyone gets wrong",
      purpose: "Earn the right to a different answer.",
      weight: 1.2,
      beats: [
        {
          title: "The assumption to drop",
          role: "reframe",
          purpose: "Overturn the belief that keeps the problem in place.",
          takeaway: "The obvious approach is the reason this has not been solved.",
          visualIntent: "comparison",
        },
      ],
    },
    {
      label: "PROVE",
      title: "Why this works",
      purpose: "Show the answer working rather than assert it.",
      weight: 1.4,
      beats: [
        {
          title: "The approach",
          role: "claim",
          purpose: "State what is being proposed, plainly.",
          takeaway: "I could explain the proposal to a colleague.",
          visualIntent: "statement",
        },
        {
          title: "Evidence it holds",
          role: "evidence",
          purpose: "Show the proof, with its limits.",
          takeaway: "There is real support, and I know how strong it is.",
          visualIntent: "data",
        },
        {
          title: "Someone it worked for",
          role: "example",
          purpose: "One concrete case beats three abstractions.",
          takeaway: "This has worked somewhere real.",
          visualIntent: "demonstration",
        },
      ],
    },
    {
      label: "ASK",
      title: "What happens next",
      purpose: "Make the decision easy to say yes to.",
      weight: 0.8,
      beats: [
        {
          title: "The ask",
          role: "close",
          purpose: "Say exactly what is being asked for and what follows.",
          takeaway: "I know what I am being asked to decide.",
          visualIntent: "statement",
        },
      ],
    },
  ],
};

const BRIEFING: Shape = {
  id: "briefing",
  cues: /\b(report|update|briefing|findings|review|status|quarter|results|analysis)\b/i,
  movements: [
    {
      label: "OPEN",
      title: "What you need to know",
      purpose: "Lead with the finding, not the method.",
      weight: 0.8,
      beats: [
        {
          title: "The headline finding",
          role: "claim",
          purpose: "State the conclusion first; this audience is busy.",
          takeaway: "I have the answer in the first thirty seconds.",
          visualIntent: "statement",
        },
      ],
    },
    {
      label: "EVIDENCE",
      title: "What the data shows",
      purpose: "Support the finding with what was actually measured.",
      weight: 1.6,
      beats: [
        {
          title: "The numbers",
          role: "evidence",
          purpose: "Show the measurement behind the headline.",
          takeaway: "I have seen the evidence, not a summary of it.",
          visualIntent: "data",
        },
        {
          title: "How to read it",
          role: "context",
          purpose: "Say what the figures do and do not support.",
          takeaway: "I know how much weight this can carry.",
          visualIntent: "comparison",
        },
      ],
    },
    {
      label: "RISK",
      title: "What could be wrong",
      purpose: "Name the weaknesses before someone else does.",
      weight: 0.8,
      beats: [
        {
          title: "What would change the conclusion",
          role: "contrast",
          purpose: "State the conditions under which this is wrong.",
          takeaway: "I know what would make this conclusion fail.",
          visualIntent: "enumeration",
        },
      ],
    },
    {
      label: "NEXT",
      title: "The decision",
      purpose: "Convert the finding into a decision.",
      weight: 0.8,
      beats: [
        {
          title: "What to do about it",
          role: "application",
          purpose: "Give the decision and its owner.",
          takeaway: "I know what happens next and who does it.",
          visualIntent: "enumeration",
        },
      ],
    },
  ],
};

const SHAPES = [TEACHING, PERSUASION, BRIEFING];

/** The argument form the request most looks like. Teaching is the default. */
export function chooseShape(prompt: string): Shape {
  let best = TEACHING;
  let bestScore = 0;

  for (const shape of SHAPES) {
    const matches = prompt.match(new RegExp(shape.cues.source, "gi"));
    const score = matches?.length ?? 0;
    if (score > bestScore) {
      best = shape;
      bestScore = score;
    }
  }

  return best;
}

/**
 * A structural narrative map, built without a model.
 *
 * The topic is woven into the movement purposes rather than into the beat
 * titles: "Focus on sepsis" reads naturally in a purpose line and reads as
 * keyword soup in a title.
 */
export function fallbackMap(prompt: string, title: string, topic: string | null): ProposedMap {
  const shape = chooseShape(prompt);

  return {
    title,
    approach:
      "Structural draft built without a language model: a real argument with a stated purpose and takeaway for every beat. The shape is sound — replace the placeholder wording with your own.",
    suggestedThemeId: "midnight",
    movements: shape.movements.map((movement) => ({
      label: movement.label,
      title: movement.title,
      purpose: topic ? `${movement.purpose} Focus on ${topic}.` : movement.purpose,
      weight: movement.weight,
      moments: movement.beats.map((beat) => ({
        title: beat.title,
        role: beat.role,
        purpose: beat.purpose,
        takeaway: beat.takeaway,
        visualIntent: beat.visualIntent,
        weight: beat.weight ?? 1,
        evidenceIds: [],
      })),
    })),
  };
}
