/**
 * SVG path data, tokenised the way the grammar reads it.
 *
 * Path data is not a flat list of numbers with letters between them. An arc
 * takes seven arguments of which the fourth and fifth are *flags* — single
 * characters, `0` or `1` — and the grammar lets them run straight into the
 * next value: `a6 6 0 01-8.943 0` is a valid arc whose flags are `0` and `1`,
 * and a regex that reads `01` as one number puts the whole picture somewhere
 * else. Lucide writes arcs exactly that way, and a face lost its mouth to it.
 */

export type PathToken = { command: string } | { number: number };

const ARC_ARITY = 7;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

export function tokenizePath(d: string): PathToken[] {
  const tokens: PathToken[] = [];
  let i = 0;
  let inArc = false;
  let argIndex = 0;

  while (i < d.length) {
    const ch = d[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      tokens.push({ command: ch });
      inArc = ch === "a" || ch === "A";
      argIndex = 0;
      i += 1;
      continue;
    }
    if (/[\s,]/.test(ch)) {
      i += 1;
      continue;
    }
    // The two flags of an arc are one character each, whatever follows them.
    if (inArc && (argIndex % ARC_ARITY === 3 || argIndex % ARC_ARITY === 4)) {
      if (ch === "0" || ch === "1") {
        tokens.push({ number: Number(ch) });
        argIndex += 1;
        i += 1;
        continue;
      }
    }
    const match = NUMBER.exec(d.slice(i));
    if (!match) {
      // Not path data. Skip the character rather than loop forever; the
      // schema's grammar check has already rejected anything hostile.
      i += 1;
      continue;
    }
    tokens.push({ number: Number(match[0]) });
    argIndex += 1;
    i += match[0].length;
  }

  return tokens;
}
