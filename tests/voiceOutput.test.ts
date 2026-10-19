import { describe, expect, it } from 'vitest';
import { toSpeech } from '../src/lib/speech/toSpeech';
import { chooseVoice, rankVoices, type VoiceInfo } from '../src/lib/speech/voices';

const voice = (name: string, lang = 'en-US', localService = true): VoiceInfo => ({ name, lang, voiceURI: name, localService });

describe('picking the most natural voice', () => {
  const voices = [
    voice('Microsoft David Desktop - English (United States)'),
    voice('Microsoft Zira Desktop - English (United States)'),
    voice('Google US English', 'en-US', false),
    voice('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
    voice('Microsoft Jenny Online (Natural) - English (United States)', 'en-US', false),
    voice('Google UK English Female', 'en-GB', false),
    voice('Google español', 'es-ES', false),
    voice('eSpeak English', 'en'),
  ];

  it('prefers Natural and Online voices over the old built-in ones', () => {
    const [first, second] = rankVoices(voices, 'en-US').map((v) => v.name);
    expect(first).toContain('Natural');
    expect(second).toContain('Natural');
    const names = rankVoices(voices, 'en-US').map((v) => v.name);
    expect(names.indexOf('Google US English')).toBeLessThan(names.indexOf('Microsoft David Desktop - English (United States)'));
    expect(names[names.length - 1]).toBe('eSpeak English');
  });

  it('leaves out voices for other languages', () => {
    expect(rankVoices(voices, 'en-US').map((v) => v.name)).not.toContain('Google español');
    expect(rankVoices(voices, 'es-ES').map((v) => v.name)).toEqual(['Google español']);
  });

  it('likes Apple’s Enhanced and Siri voices', () => {
    const apple = [voice('Samantha'), voice('Samantha (Enhanced)'), voice('Alex'), voice('Siri Voice 2')];
    expect(rankVoices(apple, 'en-US')[0].name).toMatch(/Enhanced|Siri/);
  });

  it('keeps the voice the user picked, and falls back when it is gone', () => {
    expect(chooseVoice(voices, 'en-US', 'Microsoft Zira Desktop - English (United States)')?.name).toContain('Zira');
    expect(chooseVoice(voices, 'en-US', 'Removed Voice')?.name).toContain('Natural');
    expect(chooseVoice([], 'en-US')).toBeUndefined();
  });

  it('prefers an exact locale over another English one', () => {
    const pair = [voice('Google UK English Female', 'en-GB', false), voice('Google US English', 'en-US', false)];
    expect(rankVoices(pair, 'en-GB')[0].lang).toBe('en-GB');
  });
});

describe('written text becomes spoken text', () => {
  it.each([
    ['Added “Meeting” (task 3), today from 7:00 PM to 8:00 PM.', 'Added Meeting, task 3, today from 7 to 8 PM.'],
    ['Updated "Meeting": today from 6:00 PM to 6:30 PM.', 'Updated Meeting: today from 6 to 6:30 PM.'],
    ['"Meeting" now takes 30m.', 'Meeting now takes 30 minutes.'],
    ['Moved "Gym" to tomorrow.', 'Moved Gym to tomorrow.'],
    ['Added “Study” to your day (1h 30m).', 'Added Study to your day (1 hour 30 minutes).'],
    ['Added “Reading” to your day (2h).', 'Added Reading to your day (2 hours).'],
    ['Which one do you want to delete? “Call mom (#1)”, “Call dentist (#2)”?', 'Which one do you want to delete? Call mom number 1, Call dentist number 2?'],
    ['Today you have task 1, Dentist at 4:00 PM and task 2, Gym at 6:00 PM.', 'Today you have task 1, Dentist at 4 PM and task 2, Gym at 6 PM.'],
  ])('%s', (written, spoken) => {
    expect(toSpeech(written)).toBe(spoken);
  });

  it('leaves ordinary sentences alone', () => {
    expect(toSpeech('Okay, talk to you later.')).toBe('Okay, talk to you later.');
    expect(toSpeech('')).toBe('');
  });
});
