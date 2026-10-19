// Spoken replies through the browser's built-in voices (no cost, works offline on most devices).

export const speechOutputSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split('-')[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base));
}

/** Resolves when the sentence has been spoken (or immediately when speech isn't available). */
export function speak(text: string, lang: string): Promise<void> {
  if (!speechOutputSupported() || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.02;
    // some browsers never fire `end` for a cancelled or failed utterance, so never wait forever
    const guard = setTimeout(resolve, Math.min(30_000, 2500 + text.length * 90));
    const done = () => {
      clearTimeout(guard);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
}
