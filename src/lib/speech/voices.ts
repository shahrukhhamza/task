// Picks the least robotic voice the device has. Browsers expose whatever the operating system
// ships, and the quality gap is huge: the "Natural" and "Neural" voices (Edge, Windows 11),
// Siri and the "Enhanced" Apple voices sound like people; the old built-in ones sound like a bot.

export interface VoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
}

const GOOD_NAMES = /\b(aria|jenny|sonia|libby|ryan|guy|davis|jane|nancy|sara|ava|andrew|emma|brian|michelle|samantha|allison|ava|serena|daniel|karen|moira|tessa|zoe|evan|nathan|noelle|susan)\b/i;
const ROBOTIC = /\b(david|zira|mark|hazel|george|james|richard|helen|susan desktop|espeak|compact|fred|albert|bad news|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|kathy|organ|princess|ralph|trinoids|whisper|zarvox)\b/i;

/** Higher is more natural. */
export function scoreVoice(v: VoiceInfo, lang: string): number {
  const want = lang.toLowerCase();
  const have = v.lang.toLowerCase().replace('_', '-');
  let score = 0;
  if (have === want) score += 30;
  else if (have.split('-')[0] === want.split('-')[0]) score += 15;
  else return -100;

  if (/natural|neural/i.test(v.name)) score += 60;
  else if (/online/i.test(v.name)) score += 40;
  if (/premium|enhanced|siri/i.test(v.name)) score += 45;
  if (/google/i.test(v.name)) score += 25;
  if (GOOD_NAMES.test(v.name)) score += 10;
  if (ROBOTIC.test(v.name)) score -= 40;
  // network voices (Google, Microsoft Online) are the good ones; tiny local engines are not
  if (!v.localService) score += 8;
  return score;
}

/** Voices that can read `lang`, best first. */
export function rankVoices<T extends VoiceInfo>(voices: T[], lang: string): T[] {
  return voices
    .map((v) => ({ v, score: scoreVoice(v, lang) }))
    .filter((x) => x.score > -100)
    .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v);
}

/**
 * The voice the user picked if it is still there, else the best one. With `instant`, a voice stored
 * on the device wins: online voices sound better but fetch their audio over the network first, so
 * they start talking noticeably later.
 */
export function chooseVoice<T extends VoiceInfo>(voices: T[], lang: string, preferredURI?: string, instant = false): T | undefined {
  if (preferredURI) {
    const picked = voices.find((v) => v.voiceURI === preferredURI);
    if (picked) return picked;
  }
  const ranked = rankVoices(voices, lang);
  if (instant) {
    const local = ranked.find((v) => v.localService);
    if (local) return local;
  }
  return ranked[0];
}
