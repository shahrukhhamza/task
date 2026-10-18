import { Moon, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, fieldClass } from '../../components/ui';
import { saveCheckin } from '../../lib/db/habitActions';
import type { Checkin } from '../../lib/types';
import { useUi } from '../../store/ui';

type Score = Checkin['mood'];
const MOODS = ['Awful', 'Low', 'Okay', 'Good', 'Great'];
const ENERGY = ['Drained', 'Tired', 'Steady', 'Energised', 'Buzzing'];

function Scale({ label, names, value, onChange }: { label: string; names: string[]; value: Score | null; onChange: (v: Score) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {names.map((name, i) => {
          const v = (i + 1) as Score;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={value === v}
              onClick={() => onChange(v)}
              className={`rounded-lg px-1 py-2 text-xs font-medium ${value === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'}`}
            >
              <span className="block text-base font-semibold">{v}</span>
              {name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** One-tap end-of-day mood and energy, which feed the insights and weekly report. */
export function EveningCheckin({ date, existing, hour }: { date: string; existing?: Checkin; hour: number }) {
  const toast = useUi((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [mood, setMood] = useState<Score | null>(existing?.mood ?? null);
  const [energy, setEnergy] = useState<Score | null>(existing?.energy ?? null);
  const [note, setNote] = useState(existing?.note ?? '');

  // offered from 5 PM; once done it shrinks to a one-line summary
  if (!existing && hour < 17 && !editing) return null;

  if (existing && !editing) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-slate-900">
        <Moon size={16} className="text-teal-700 dark:text-teal-300" />
        <span className="flex-1">
          Checked in: mood {existing.mood}/5 ({MOODS[existing.mood - 1].toLowerCase()}), energy {existing.energy}/5
        </span>
        <button type="button" aria-label="Edit check-in" onClick={() => setEditing(true)} className="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Pencil size={14} />
        </button>
      </div>
    );
  }

  return (
    <Card className="mb-4 grid gap-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Moon size={18} className="text-teal-700 dark:text-teal-300" /> Evening check-in
      </h2>
      <Scale label="How was your mood today?" names={MOODS} value={mood} onChange={setMood} />
      <Scale label="How was your energy?" names={ENERGY} value={energy} onChange={setEnergy} />
      <div>
        <label htmlFor="checkin-note" className="mb-1 block text-sm font-medium">
          Anything worth remembering? <span className="font-normal text-slate-600 dark:text-slate-400">(optional)</span>
        </label>
        <input id="checkin-note" className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Slept badly, great workout…" />
      </div>
      <div className="flex justify-end gap-2">
        {existing && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          disabled={!mood || !energy}
          onClick={async () => {
            if (!mood || !energy) return;
            await saveCheckin(date, { mood, energy, note });
            setEditing(false);
            toast('Check-in saved. Thanks.');
          }}
        >
          Save check-in
        </Button>
      </div>
    </Card>
  );
}
