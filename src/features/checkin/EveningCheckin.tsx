import { Moon, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Bento, Kicker } from '../../components/ui';
import { saveCheckin } from '../../lib/db/habitActions';
import type { Checkin } from '../../lib/types';
import { useUi } from '../../store/ui';

type Score = Checkin['mood'];
const MOODS = [
  { emoji: '😞', label: 'Awful' },
  { emoji: '😕', label: 'Low' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '🙂', label: 'Good' },
  { emoji: '😄', label: 'Great' },
];
const ENERGY = [
  { emoji: '🪫', label: 'Drained' },
  { emoji: '😴', label: 'Tired' },
  { emoji: '🙂', label: 'Steady' },
  { emoji: '⚡', label: 'Energised' },
  { emoji: '🚀', label: 'Buzzing' },
];

function Scale({ legend, items, value, onChange }: { legend: string; items: typeof MOODS; value: Score | null; onChange: (v: Score) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-bold">{legend}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {items.map((item, i) => {
          const v = (i + 1) as Score;
          return (
            <button
              key={item.label}
              type="button"
              aria-pressed={value === v}
              aria-label={`${item.label} (${v} of 5)`}
              onClick={() => onChange(v)}
              className={`flex flex-col items-center rounded-2xl py-2 text-xs font-bold transition ${value === v ? 'bg-ink text-white' : 'bg-white/60 hover:bg-white'}`}
            >
              <span className="text-xl" aria-hidden>
                {item.emoji}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One-tap end-of-day mood and energy; it feeds the insights and the progress page. */
export function EveningCheckin({ date, existing, hour }: { date: string; existing?: Checkin; hour: number }) {
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [mood, setMood] = useState<Score | null>(existing?.mood ?? null);
  const [energy, setEnergy] = useState<Score | null>(existing?.energy ?? null);

  // offered from 5 PM; once done it shrinks to one line
  if (!existing && hour < 17 && !editing) return null;

  if (existing && !editing) {
    return (
      <div className="flex items-center gap-3 rounded-[22px] bg-surface px-4 py-3 text-sm">
        <span className="text-xl" aria-hidden>
          {MOODS[existing.mood - 1].emoji}
        </span>
        <span className="flex-1 font-semibold">
          Checked in: feeling {MOODS[existing.mood - 1].label.toLowerCase()}, energy {ENERGY[existing.energy - 1].label.toLowerCase()}
        </span>
        <button type="button" aria-label="Edit check-in" onClick={() => setEditing(true)} className="rounded-full p-2 hover:bg-surface-2">
          <Pencil size={15} />
        </button>
      </div>
    );
  }

  return (
    <Bento tone="sun" className="rise grid gap-4">
      <div className="flex items-center gap-2">
        <Moon size={18} />
        <Kicker>Evening check-in</Kicker>
      </div>
      <h2 className="-mt-2 text-2xl font-bold leading-tight">How was today?</h2>
      <Scale legend="Mood" items={MOODS} value={mood} onChange={setMood} />
      <Scale legend="Energy" items={ENERGY} value={energy} onChange={setEnergy} />
      <button
        type="button"
        disabled={!mood || !energy}
        onClick={async () => {
          if (!mood || !energy) return;
          await saveCheckin(date, { mood, energy });
          setEditing(false);
          toast('Saved. Sleep well.');
        }}
        className="h-12 rounded-full bg-ink font-bold text-white transition disabled:opacity-40"
      >
        Save check-in
      </button>
    </Bento>
  );
}
