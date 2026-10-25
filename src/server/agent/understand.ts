/**
 * Plain-language front end for the NLU.
 *
 * New staff don't talk in front-desk vocabulary. They type fast, misspell
 * things and describe the situation instead of naming the action: "how do I
 * take a customer out of the hotel", "the guest is at the front desk with
 * their bags", "room 203 is ready", "chek out rom 204". This module turns
 * that into the canonical phrasing nlu.ts already understands ("check out
 * the guest", "mark room 203 clean", "check out room 204") before parsing,
 * and keeps track of whether the person was asking *how* to do something so
 * the agent can explain it along the way.
 *
 * Deterministic and dependency-free, like the rest of the NLU.
 */

export type HowToTopic = 'checkOut' | 'checkIn' | 'booking' | 'cancel' | 'noShow' | 'moveRoom' | 'cleaning' | 'outOfOrder' | 'note';

export interface Understood {
  /** The message rewritten into the agent's canonical phrasing. */
  text: string;
  /** The person asked how to do something ("how do I…", "what do I do to…"). */
  howTo: boolean;
  /** The person described a guest at the desk without saying whether they're arriving or leaving. */
  atDesk?: string;
}

// ---------------------------------------------------------------------------
// Typos
// ---------------------------------------------------------------------------

/** Common misspellings and shorthand that are too short or too far off for the fuzzy matcher. */
const TYPOS: Record<string, string> = {
  rom: 'room',
  romm: 'room',
  rooom: 'room',
  rm: 'room',
  gest: 'guest',
  guset: 'guest',
  gueset: 'guest',
  trake: 'take',
  tkae: 'take',
  taek: 'take',
  tak: 'take',
  chk: 'check',
  chekc: 'check',
  chcek: 'check',
  chek: 'check',
  cehck: 'check',
  chekin: 'checkin',
  chekout: 'checkout',
  chkout: 'checkout',
  chkin: 'checkin',
  cust: 'customer',
  custmer: 'customer',
  costumer: 'customer',
  costomer: 'customer',
  cusotmer: 'customer',
  teh: 'the',
  tahe: 'the',
  hte: 'the',
  fornt: 'front',
  fromnt: 'front',
  frnt: 'front',
  dsk: 'desk',
  recepion: 'reception',
  hotle: 'hotel',
  htoel: 'hotel',
  resrvation: 'reservation',
  reservaton: 'reservation',
  reservtion: 'reservation',
  rezervation: 'reservation',
  bookin: 'booking',
  bokking: 'booking',
  boking: 'booking',
  tmrw: 'tomorrow',
  tmr: 'tomorrow',
  tomorow: 'tomorrow',
  tommorow: 'tomorrow',
  tommorrow: 'tomorrow',
  '2day': 'today',
  tdy: 'today',
  plz: 'please',
  pls: 'please',
  u: 'you',
  ppl: 'people',
};

/** Words the fuzzy matcher may correct towards. Kept to the front-desk vocabulary on purpose. */
const VOCAB = [
  'check', 'checkin', 'checkout', 'checking', 'checked', 'guest', 'guests', 'customer', 'customers', 'reservation', 'reservations',
  'booking', 'bookings', 'room', 'rooms', 'arrival', 'arrivals', 'arriving', 'arrived', 'departure', 'departures', 'departing',
  'leaving', 'leave', 'cancel', 'cancelled', 'confirm', 'housekeeping', 'clean', 'cleaning', 'dirty', 'inspected', 'occupancy',
  'availability', 'available', 'tomorrow', 'today', 'tonight', 'weekend', 'weekends', 'front', 'desk', 'reception', 'hotel',
  'note', 'assign', 'show', 'staying', 'upgrade', 'broken', 'maintenance', 'service', 'order', 'please', 'customer', 'luggage',
  'payment', 'settle', 'balance', 'register', 'keys',
];
const VOCAB_SET = new Set(VOCAB);

/** Real words one letter away from the vocabulary that mean something else ("leaking" isn't "leaving"). */
const PROTECTED = new Set(['leaking', 'leasing', 'leaning', 'leaves', 'clear', 'clearing', 'cleared', 'cleaner', 'staring', 'storing', 'older', 'cheap', 'notes', 'hostel', 'motel', 'shows', 'order', 'orders', 'service', 'services', 'arrive', 'books', 'booked', 'booker', 'rooted', 'roomy']);

/** Words glued to an article ("acustomer", "theguest"). */
const GLUED_RE = /^(a|an|the|my|to)([a-z]{4,})$/;

/** Damerau–Levenshtein distance (adjacent transpositions count as one edit), capped for speed. */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function correctWord(word: string): string {
  const lower = word.toLowerCase();
  if (TYPOS[lower]) return TYPOS[lower];
  // Capitalised words are probably names: never "correct" a guest's name.
  if (word[0] !== lower[0] || lower.length < 5 || VOCAB_SET.has(lower) || PROTECTED.has(lower) || /\d/.test(lower)) return word;
  const glued = lower.match(GLUED_RE);
  if (glued && (VOCAB_SET.has(glued[2]) || TYPOS[glued[2]])) return `${glued[1]} ${TYPOS[glued[2]] ?? glued[2]}`;
  const allowed = lower.length >= 8 ? 2 : 1;
  let best: string | undefined;
  let bestD = allowed + 1;
  for (const v of VOCAB) {
    if (v[0] !== lower[0] && lower.length < 8) continue;
    const dist = editDistance(lower, v, allowed);
    if (dist < bestD) {
      best = v;
      bestD = dist;
    }
  }
  return best ?? word;
}

export function fixTypos(text: string): string {
  // "#TENANT" is a booking code, not a word.
  return text.replace(/#?[A-Za-z0-9]+/g, (w) => (w.startsWith('#') ? w : correctWord(w)));
}

// ---------------------------------------------------------------------------
// Rephrasing
// ---------------------------------------------------------------------------

/** "how do I …", "what do I do to …", "can you help me …", "I want to …" in front of an action. */
const HOW_TO_RE =
  /^\s*(?:(?:hi|hey|hello|ok|okay|so|um|uh|please)[,!.\s]+)*(?:how\s+(?:do|can|should|would)\s+(?:i|we|you)|how\s+to|what\s+(?:do|should)\s+(?:i|we)\s+do\s+(?:to|when|if)|what(?:'s| is)\s+the\s+way\s+to|where\s+do\s+(?:i|we)|can\s+you\s+(?:help\s+me|show\s+me\s+how\s+to|tell\s+me\s+how\s+to)|help\s+me|i\s+(?:want|need|have)\s+to|we\s+(?:want|need|have)\s+to|i(?:'d| would)\s+like\s+to|i\s+wanna|is\s+there\s+a\s+way\s+to)\s+/i;

/** A guest reference a rule can carry across: names, "the guest", "room 204", a code or a pronoun. */
const WHO = String.raw`((?:the |a |this |that |our |my |mr\.? |mrs\.? |ms\.? )?(?:guests?|room\s*#?\s*\d{1,4}[a-z]?|[A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,2}?))`;

/** Subjects that are questions or crowds, not a guest ("who is leaving", "everyone is here"). */
const NOT_A_GUEST = /^(?:who|what|which|how|when|where|why|anyone|anybody|everyone|everybody|any|all|nobody|no one|it|there|i|we|you)\b|^(?:this|that)$/i;

const FILLER = /^(?:so|ok|okay|hey|hi|hello|um|uh|well|now|and|but|then|also|just|please|look|listen|yeah|yes)\b[,\s]*/i;

/** Tidy a captured guest reference ("so the guest" → "the guest"); an empty one becomes "the guest". */
function cleanWho(who: string | undefined): string {
  let w = (who ?? '').trim();
  while (FILLER.test(w)) w = w.replace(FILLER, '');
  return w;
}

/** "a guest", "the guest", "our guest": nobody in particular, so the agent asks which one. */
const GENERIC_GUEST = /^(?:(?:the|a|an|our|my)\s+)?guests?$/i;

const keep = (who: string | undefined) => {
  const w = cleanWho(who);
  return w && !GENERIC_GUEST.test(w) ? ` ${w}` : ' a guest';
};

interface Rule {
  re: RegExp;
  to: (m: RegExpMatchArray) => string;
}

const LEAVE_WORDS = String.raw`(?:leaving|checking out|going home|heading out|departing|done|finished|all done|ready to (?:leave|go|check ?out|pay))`;

const RULES: Rule[] = [
  // --- Check-out --------------------------------------------------------------
  // "take the guest out of the hotel", "get Smith out", "sign room 204 out" (but not "take 106 out of service/order")
  {
    re: new RegExp(String.raw`\b(?:take|get|sign|book|walk|see)\s+${WHO}\s+(?:out|off)\b(?!\s+of\s+(?:order|service))(?:\s+(?:of|from)\s+(?:the\s+)?(?:hotel|room|property|system|building|here))?`, 'i'),
    to: (m) => `check out${keep(m[1])}`,
  },
  { re: /\b(?:take|get|sign|book)\s+(?:out|off)\s+(?:the\s+)?(guest)s?\b/i, to: () => 'check out the guest' },
  // "Smith is leaving", "the guest in room 204 is done", "they're ready to go"
  {
    re: new RegExp(String.raw`${WHO}\s+(?:is|are|'s|’s|'re|’re)\s+(?:now\s+|just\s+)?${LEAVE_WORDS}\b(?:\s+(?:today|now|this morning))?`, 'i'),
    to: (m) => `check out${keep(m[1])}`,
  },
  // "Smith wants to leave", "the guest needs to pay and go"
  {
    re: new RegExp(String.raw`${WHO}\s+(?:wants?|needs?|would like|wishes)\s+to\s+(?:leave|go(?: home)?|check ?out|pay(?: and (?:leave|go))?|settle up)\b`, 'i'),
    to: (m) => `check out${keep(m[1])}`,
  },
  // "when a guest leaves", "if Smith checks out"
  { re: new RegExp(String.raw`${WHO}\s+(?:leaves|departs|checks out|goes home|wants to go)\b`, 'i'), to: (m) => `check out${keep(m[1])}` },
  // "close Smith's bill", "settle the guest's account", "end the stay for room 204"
  {
    re: /\b(?:close|settle|finish|end|finali[sz]e|clear)\s+(?:out\s+)?(?:the\s+)?(?:([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*)?)(?:'s|’s)\s+)?(?:stay|bill|folio|tab|account|invoice)\b(?:\s+(?:for|of)\s+(.+?))?(?=$|[,.;!?]|\s+and\b)/i,
    to: (m) => `check out${keep(m[2] ?? m[1])}`,
  },
  // "release / vacate / free up room 204"
  { re: /\b(?:release|vacate|free up|empty)\s+(?:the\s+)?(room\s*#?\s*\d{1,4}[a-z]?)/i, to: (m) => `check out ${m[1]}` },

  // --- Check-in ---------------------------------------------------------------
  // "Smith has arrived", "the guest is here", "they just got here"
  {
    re: new RegExp(String.raw`${WHO}\s+(?:has|have|just|has just|have just|'s|’s)?\s*(?:arrived|showed up|turned up|got here|is here|are here|is here now|are here now|is arriving now)\b(?!\s+(?:today|tomorrow)\?)`, 'i'),
    to: (m) => `check in${keep(m[1])}`,
  },
  // "when a guest arrives", "if Smith comes in"
  { re: new RegExp(String.raw`${WHO}\s+(?:arrives|comes in|checks in|walks in)\b`, 'i'), to: (m) => `check in${keep(m[1])}` },
  // "let the guest in", "sign Smith in", "book them in"
  { re: new RegExp(String.raw`\b(?:let|sign|book|bring)\s+${WHO}\s+in\b(?!\s*(?:to\s+)?rooms?\b)`, 'i'), to: (m) => `check in${keep(m[1])}` },
  // "give Smith their key", "hand the guest the room keys"
  {
    re: new RegExp(String.raw`\b(?:give|hand)\s+${WHO}\s+(?:the|their|his|her|a|an)?\s*(?:room\s+)?(?:keys?|key ?cards?)\b`, 'i'),
    to: (m) => `check in${keep(m[1])}`,
  },
  // "register Smith"
  { re: new RegExp(String.raw`\bregister\s+${WHO}(?=$|[,.;!?]|\s+(?:and|into|in)\b)`, 'i'), to: (m) => `check in${keep(m[1])}` },

  // --- Guest at the desk ------------------------------------------------------
  // With a reason: "the guest is at the front desk with their bags / to pay" → leaving; "to check in / with a booking" → arriving.
  {
    re: new RegExp(
      String.raw`${WHO}\s+(?:is|are|'s|’s)\s+(?:at|by|waiting at|standing at|in front of)\s+(?:the\s+)?(?:front\s+)?(?:desk|reception|counter|lobby)\s+(?:with\s+(?:their|his|her|the)\s+(?:bags|luggage|suitcases?)|to\s+(?:pay|leave|check ?out|settle|return (?:the|their|his|her) keys?))`,
      'i'
    ),
    to: (m) => `check out${keep(m[1])}`,
  },
  {
    re: new RegExp(String.raw`${WHO}\s+(?:is|are|'s|’s)\s+(?:at|by|waiting at|standing at|in front of)\s+(?:the\s+)?(?:front\s+)?(?:desk|reception|counter|lobby)\s+(?:to\s+check ?in|with\s+a\s+(?:booking|reservation))`, 'i'),
    to: (m) => `check in${keep(m[1])}`,
  },

  // --- Cancellations and no-shows ----------------------------------------------
  {
    re: new RegExp(String.raw`${WHO}\s+(?:didn't|did not|didnt|never|hasn't|has not|hasnt)\s+(?:show(?:n)?(?: up)?|come|arrive(?:d)?|turn(?:ed)? up)\b`, 'i'),
    to: (m) => `mark${keep(m[1])} as no-show`,
  },
  {
    re: new RegExp(String.raw`${WHO}\s+(?:called to cancel|wants to cancel|cancelled|canceled|isn't coming|is not coming|isnt coming|aren't coming|are not coming|won't be coming|can't make it|cannot make it)\b`, 'i'),
    to: (m) => `cancel${keep(m[1])}`,
  },

  // --- Rooms ------------------------------------------------------------------
  // "room 203 is ready / done / cleaned" → mark clean
  { re: /\b(room\s*#?\s*\d{1,4}[a-z]?)\s+(?:is|has been|was)\s+(?:now\s+)?(?:ready|done|cleaned|tidied|made up|all clean)\b/i, to: (m) => `mark ${m[1]} clean` },
  // "room 106 is broken / not working / leaking because …" → out of order
  {
    re: /\b(room\s*#?\s*\d{1,4}[a-z]?)\s+(?:is\s+|has\s+)?(?:broken|not working|leaking|flooded|damaged|unusable|no (?:power|water|hot water|ac|heating))\b/i,
    to: (m) => `${m[1]} out of order because ${m[0].replace(m[1], '').trim().replace(/^(?:is|has)\s+/i, '')}`,
  },
  // "change / swap Smith's room", "the guest doesn't like their room"
  {
    re: /\b(?:change|swap|switch)\s+(?:the\s+)?(?:([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*)?)(?:'s|’s)?\s+)?room\b(?!\s*#?\s*\d)/i,
    to: (m) => `move${keep(m[1])} to another room`,
  },
  { re: new RegExp(String.raw`${WHO}\s+(?:doesn't|does not|doesnt|don't|do not)\s+like\s+(?:the|their|his|her)\s+room\b`, 'i'), to: (m) => `move${keep(m[1])} to another room` },

  // --- New bookings -----------------------------------------------------------
  // There's no "create booking" tool: show what's free and at what price, which is where a booking starts.
  {
    re: /\b(?:(?:make|create|add|take|do)\s+(?:a\s+)?(?:new\s+)?(?:booking|reservation)|(?:book|reserve)\s+(?:a\s+)?rooms?|new\s+(?:booking|reservation)|walk[\s-]?ins?|(?:wants?|needs?|looking for)\s+(?:a\s+)?rooms?)\b/i,
    to: () => 'availability',
  },
];

/** Plain-word synonyms for the guest. */
function synonyms(text: string): string {
  return text
    .replace(/(?<!#)\b(?:customer|client|visitor|patron|occupant|tenant|resident|traveller|traveler|person|lady|gentleman|man|woman|guy)(s?)\b/gi, 'guest$1')
    .replace(/(?<!#)\b(?:people|folks|family)\b(?=\s+(?:is|are|in room|at|wants?|has|have|just))/gi, 'guests')
    .replace(/\b(?:someone|somebody)\b/gi, 'a guest')
    .replace(/\bcheck(?:ing)?\s*-\s*(in|out)\b/gi, 'check $1')
    .replace(/\s{2,}/g, ' ');
}

/** "the guest is at the front desk" with no reason: arriving or leaving is the agent's call to ask. */
const AT_DESK_RE = new RegExp(String.raw`^\s*(?:there(?:'s| is)\s+)?${WHO}\s+(?:is|are|'s|’s|at)?\s*(?:at|by|waiting at|standing at|in front of)\s+(?:the\s+)?(?:front\s+)?(?:desk|reception|counter|lobby)\b`, 'i');

const ACTION_START_RE = /^(?:take|get|sign|book|check|let|give|hand|register|close|settle|release|vacate|free|cancel|mark|move|change|swap|switch|make|create|add|reserve|assign|put|note|clean|availability)\b/i;

function rephrase(text: string): string {
  let out = synonyms(text);
  for (const rule of RULES) {
    const m = out.match(rule.re);
    if (!m || m.index === undefined) continue;
    // "who is leaving today?" is a question about departures, not a guest called "who".
    const who = cleanWho(m[1]);
    if (who && NOT_A_GUEST.test(who)) continue;
    out = `${out.slice(0, m.index)}${rule.to(m)}${out.slice(m.index + m[0].length)}`;
  }
  return out.replace(/\s{2,}/g, ' ').replace(/^\s*[,.]\s*/, '').trim();
}

export function understand(message: string): Understood {
  const fixed = fixTypos(message);
  let text: string | undefined;
  let howTo = false;
  const how = fixed.match(HOW_TO_RE);
  if (how) {
    // Only an action counts: "how do I use this" stays help, "how many rooms" stays a question.
    const rest = rephrase(fixed.slice(how[0].length));
    if (ACTION_START_RE.test(rest)) {
      // "I want to check out Smith" is a request; "how do I check a guest out?" also wants the explanation.
      howTo = /\b(?:how|what|where|show me how|tell me how|help me|is there a way)\b/i.test(how[0]);
      text = rest;
    }
  }
  text ??= rephrase(fixed);
  if (!/\bcheck\s+(?:in|out)\b/i.test(text)) {
    const desk = text.match(AT_DESK_RE);
    const who = cleanWho(desk?.[1]);
    if (desk && !NOT_A_GUEST.test(who)) {
      return { text, howTo, atDesk: GENERIC_GUEST.test(who) ? '' : who };
    }
  }
  return { text, howTo };
}

/** Which how-to explanation fits a parsed action. */
export function howToTopic(kind: string): HowToTopic | undefined {
  switch (kind) {
    case 'checkOut':
      return 'checkOut';
    case 'checkIn':
      return 'checkIn';
    case 'availability':
      return 'booking';
    case 'cancel':
      return 'cancel';
    case 'noShow':
      return 'noShow';
    case 'assignRoom':
      return 'moveRoom';
    case 'roomStatus':
    case 'assignCleaning':
    case 'autoAssignCleaning':
      return 'cleaning';
    case 'outOfOrder':
      return 'outOfOrder';
    case 'note':
      return 'note';
    default:
      return undefined;
  }
}

export const HOW_TO_TEXT: Record<HowToTopic, string> = {
  checkOut:
    '**Checking a guest out** means ending their stay: tell me who is leaving (their name, room number or confirmation code), for example “check out room 204”. I’ll show any unpaid balance first, nothing changes until you press **Confirm**, and the room then goes to housekeeping.',
  checkIn:
    '**Checking a guest in** means starting their stay: tell me who has arrived (name, room or confirmation code), for example “check in Grace Okafor”. I’ll pick a ready room (or use the one you name), and nothing changes until you press **Confirm**.',
  booking:
    '**Taking a new booking** starts with what’s free: tell me the dates and how many people, for example “availability Friday for 2 nights, 2 guests”, and I’ll show the rooms and exact prices.',
  cancel: '**Cancelling a reservation:** tell me whose booking it is (name or confirmation code), for example “cancel K7Q2MD”. You’ll confirm before anything changes.',
  noShow: '**Marking a no-show** is for a guest who never arrived: tell me who, for example “mark Smith as no-show”. You’ll confirm before anything changes.',
  moveRoom: '**Moving a guest to another room:** tell me who and, if you like, which room or what they want, for example “move Smith to 305” or “give Smith a quiet room”.',
  cleaning: '**Housekeeping:** say “mark 203 clean” when a room is ready, “have Rosa clean 303” to send someone, or “auto-assign housekeeping” to share out all the dirty rooms.',
  outOfOrder: '**Taking a room out of order** stops it being sold: for example “room 106 out of order because the AC is broken”. Say “room 106 back in service” when it’s fixed.',
  note: '**Adding a note** to a booking: for example “add a note to Smith: late arrival”.',
};

// ---------------------------------------------------------------------------
// Best guesses for messages nothing else understood
// ---------------------------------------------------------------------------

export interface Guess {
  label: string;
  hint: string;
  command: string;
}

const GUESSES: { re: RegExp; guess: Guess }[] = [
  { re: /\b(leav|out\b|bill|pay|paid|depart|go(?:ing)? home|luggage|bags|keys? back|return(?:ed)? (?:the )?keys?|exit)/i, guess: { label: 'Check a guest out', hint: 'end a stay', command: 'check out a guest' } },
  { re: /\b(arriv|here|came|come in|key|register|new guest|in\b)/i, guess: { label: 'Check a guest in', hint: 'start a stay', command: 'check in a guest' } },
  { re: /\b(book|reserv|stay|night|free|vacan|price|rate|cost)/i, guess: { label: 'Check availability', hint: 'rooms and prices for tonight', command: 'availability tonight' } },
  { re: /\b(clean|dirty|housekeep|maid|towel|sheets|tidy|mess)/i, guess: { label: 'Rooms to clean', hint: 'the cleaning list', command: 'which rooms need cleaning?' } },
  { re: /\b(broken|fix|repair|leak|maintenance|not working)/i, guess: { label: 'Out-of-order rooms', hint: 'rooms that can’t be sold', command: 'show out-of-order rooms' } },
  { re: /\b(guest|who|staying|find|look|name|reservation|booking)/i, guess: { label: 'Who’s staying now', hint: 'guests in house', command: 'who is in house?' } },
];

/** Up to three likely actions for a message the parser couldn't place, so a new user gets a tap instead of a dead end. */
export function guessActions(message: string): Guess[] {
  const t = fixTypos(synonyms(message));
  return GUESSES.filter((g) => g.re.test(t))
    .map((g) => g.guess)
    .slice(0, 3);
}
