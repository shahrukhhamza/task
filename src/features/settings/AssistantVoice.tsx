import { Play } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Button, fieldClass } from '../../components/ui';
import { DEFAULT_VOICE_PREFS, loadVoicePrefs, saveVoicePrefs, speak, speechOutputSupported, type VoicePrefs } from '../../lib/speech/speak';
import { chooseVoice, rankVoices, scoreVoice } from '../../lib/speech/voices';

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (speechOutputSupported() ? window.speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (!speechOutputSupported()) return;
    const update = () => setVoices(window.speechSynthesis.getVoices());
    update();
    // most browsers load their voices a moment after the page does
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

const SAMPLE = 'Hi, I’m Dayflow. Your meeting is at 6 PM tonight, and I’ve moved the gym to tomorrow.';

/** Which voice the assistant answers in, how fast, with a button to hear it. */
export function AssistantVoice() {
  const id = useId();
  const voices = useVoices();
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const ranked = useMemo(() => rankVoices(voices, 'en-US'), [voices]);
  const best = useMemo(() => chooseVoice(voices, 'en-US', undefined, prefs.instant), [voices, prefs.instant]);

  if (!speechOutputSupported()) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium">Assistant voice</p>
        <p className="text-sm text-muted">This browser can’t speak answers out loud. The assistant still shows them on screen.</p>
      </div>
    );
  }

  const update = (next: Partial<VoicePrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    saveVoicePrefs(merged);
  };

  const natural = (v: SpeechSynthesisVoice) => scoreVoice(v, 'en-US') >= 70;

  return (
    <div className="grid gap-3">
      <div>
        <label htmlFor={`${id}-voice`} className="mb-1 block text-sm font-medium">
          Assistant voice
        </label>
        <select id={`${id}-voice`} className={fieldClass} value={prefs.voiceURI ?? ''} onChange={(e) => update({ voiceURI: e.target.value || undefined })}>
          <option value="">Automatic{best ? ` · ${best.name}` : ''}</option>
          {ranked.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
              {natural(v) ? ' · natural' : ''}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          Automatic picks the most natural voice your device has. In Microsoft Edge, voices marked “Natural” or “Online” sound the most human; on iPhone and Mac, try an Enhanced or Siri voice.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-[16px] border border-line p-3.5">
        <input
          type="checkbox"
          role="switch"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--app-fg)]"
          checked={prefs.instant === true}
          onChange={(e) => update({ instant: e.target.checked })}
        />
        <span>
          <span className="block text-[15px] font-medium">Instant replies</span>
          <span className="block text-sm text-muted">Use a voice stored on this device. It starts talking at once; online “Natural” voices sound better but take a moment to start.</span>
        </span>
      </label>

      <div>
        <label htmlFor={`${id}-rate`} className="mb-1 flex items-center justify-between text-sm font-medium">
          Speed <span className="text-muted">{prefs.rate.toFixed(2).replace(/0$/, '')}×</span>
        </label>
        <input
          id={`${id}-rate`}
          type="range"
          min={0.7}
          max={1.4}
          step={0.05}
          value={prefs.rate}
          onChange={(e) => update({ rate: +e.target.value })}
          className="w-full accent-[var(--app-fg)]"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void speak(SAMPLE, 'en-US', prefs)}>
          <Play size={14} fill="currentColor" /> Hear it
        </Button>
        {(prefs.voiceURI || prefs.instant || prefs.rate !== DEFAULT_VOICE_PREFS.rate) && (
          <Button size="sm" variant="ghost" onClick={() => update({ voiceURI: undefined, instant: false, rate: DEFAULT_VOICE_PREFS.rate })}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
