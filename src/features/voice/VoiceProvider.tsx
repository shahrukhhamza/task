import { createContext, useContext, type ReactNode } from 'react';
import type { Profile } from '../../lib/types';
import { useUi } from '../../store/ui';
import { useVoiceSession, type VoiceSession } from './useVoiceSession';

const VoiceContext = createContext<VoiceSession | null>(null);

/** Keeps one voice assistant for the whole app, so it carries on while you use any page. */
export function VoiceProvider({ profile, children }: { profile: Profile; children: ReactNode }) {
  const on = useUi((s) => s.voiceOn);
  const setVoice = useUi((s) => s.setVoice);
  const session = useVoiceSession(profile, on, () => setVoice(false));
  return <VoiceContext.Provider value={session}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceSession {
  const session = useContext(VoiceContext);
  if (!session) throw new Error('useVoice needs a VoiceProvider');
  return session;
}
