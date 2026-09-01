/**
 * What counts as a password here.
 *
 * The rule used to be eight characters and nothing else, which admits
 * `password`, `12345678` and `aaaaaaaa` — the three shapes that actually turn
 * up in credential-stuffing lists. Length alone has been known to be a weak
 * proxy for strength for years; it is the guess that costs an attacker nothing
 * that matters, not the character count.
 *
 * This is deliberately *not* a re-implementation of Supabase's leaked-password
 * check. That feature asks HaveIBeenPwned over a k-anonymity range query and
 * knows about billions of breached credentials; nothing in this file could
 * approach it, and putting an outbound request in the sign-up path would mean
 * deciding what happens when the third party is slow. The platform setting is
 * the right home for that, and it is a dashboard toggle.
 *
 * What this does instead is refuse the guesses that need no breach corpus at
 * all: the handful of passwords tried first against every login form, and the
 * ones sitting in plain sight on the same form — the address being registered
 * and the name being typed two fields up. Those are free to check, cannot fail
 * open, and are worth refusing whether or not the platform check is on.
 */

/**
 * Not a top-N list, and not trying to be.
 *
 * A long list belongs in a breach database, not a bundle. These are the entries
 * that head essentially every published "most common passwords" analysis, plus
 * the ones this product invites by name — a presentation tool gets `captivate`
 * and `presentation` the way a bank gets `bank`.
 */
const COMMON = new Set([
  "password",
  "passw0rd",
  "password1",
  "password123",
  "p@ssword",
  "p@ssw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "123123123",
  "111111111",
  "000000000",
  "qwertyui",
  "qwerty123",
  "asdfghjk",
  "1qaz2wsx",
  "zaq12wsx",
  "qazwsxedc",
  "iloveyou",
  "princess",
  "sunshine",
  "football",
  "baseball",
  "superman",
  "trustno1",
  "letmein1",
  "welcome1",
  "monkey12",
  "dragon12",
  "abc12345",
  "captivate",
  "presentation",
  "slideshow",
  "keynote1",
  "powerpoint",
]);

/** Collapses the substitutions that fool a plain lookup: `P@ssw0rd!` → `password`. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[$5]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z0-9]/g, "");
}

/** One character, or one character repeated: `aaaaaaaa`, `--------`. */
function isSingleCharacter(value: string): boolean {
  return new Set(value).size === 1;
}

/**
 * The runs a finger makes without the mind joining in.
 *
 * The alphabet, the number row and the three letter rows, because "sequential"
 * to someone at a login form means the keys next to each other rather than the
 * code points behind them. Comparing character codes catches `abcdefghij` and
 * lets `qwertyuiop` straight through — the longest and most-typed run on the
 * board, exactly ten characters, so it clears a ten-character minimum without
 * being a word, a repeat, or an entry on any short list.
 *
 * A password has to *be* a run, not merely contain one: flagging every string
 * with `asd` inside it would refuse real passphrases for no gain, and this
 * check earns its place by being certain rather than by casting wide.
 */
const TRACKS = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiop",
  // Both of these are shorter than `PASSWORD_MIN`, so nothing matching them
  // can reach this check — the length gate has already refused it. They are
  // here so the table stays complete if that minimum ever moves, not because
  // they fire today.
  "asdfghjkl",
  "zxcvbnm",
];

function isSequential(value: string): boolean {
  const lower = value.toLowerCase();
  if (lower.length < 4) return false;
  const backwards = [...lower].reverse().join("");
  return TRACKS.some((track) => track.includes(lower) || track.includes(backwards));
}

/**
 * Whether the password is really just something else on the same form.
 *
 * Compared after normalising and in both directions, because `alexsmith` as a
 * password for `alex.smith@work.com` is the same guess whichever way round the
 * containment runs.
 */
function echoes(password: string, other: string | undefined): boolean {
  if (!other) return false;
  const a = normalise(password);
  const b = normalise(other.split("@")[0] ?? other);
  if (a.length < 4 || b.length < 4) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * The same list after substitution-folding, checked alongside the raw one.
 *
 * Folding only the input is not enough and folding only the list is worse:
 * `P@ssw0rd` needs the input folded to match `password`, while `12345678`
 * needs the raw form, because folding turns its digits into letters. Checking
 * both sides costs one extra `Set` and removes the gap where a common password
 * containing digits — which is most of them — slipped through.
 */
const COMMON_FOLDED = new Set([...COMMON].map(normalise));

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/**
 * Returns the reason a password is refused, or null when it is acceptable.
 *
 * The messages say what to change rather than restating the rule, because a
 * sign-up form is the worst possible place to make somebody guess.
 */
export function passwordProblem(
  password: string,
  context: { email?: string; displayName?: string } = {},
): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters — length is what actually makes a password hard to guess.`;
  }
  if (password.length > PASSWORD_MAX) {
    return "That password is too long.";
  }
  if (isSingleCharacter(password)) {
    return "That's one character repeated. Try a few unrelated words instead.";
  }
  if (isSequential(password)) {
    return "That's a straight run of keys. Try a few unrelated words instead.";
  }
  if (COMMON.has(password.toLowerCase()) || COMMON_FOLDED.has(normalise(password))) {
    return "That password is one of the first things an attacker tries. Try a few unrelated words instead.";
  }
  if (echoes(password, context.email)) {
    return "That's too close to your email address, which is the other half of the login.";
  }
  if (echoes(password, context.displayName)) {
    return "That's too close to your name. Try something unrelated to you.";
  }
  return null;
}
