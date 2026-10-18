import { create } from 'zustand';
import { cloudConfigured } from '../lib/cloud/client';

export interface CloudUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export type GoogleStatus = 'unknown' | 'connected' | 'disconnected' | 'reconnect' | 'error';

interface CloudState {
  configured: boolean;
  /** True once we know whether someone is signed in. */
  ready: boolean;
  user: CloudUser | null;
  syncStatus: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt?: number;
  syncError?: string;
  google: GoogleStatus;
  googleError?: string;
  lastImportAt?: number;
  patch: (changes: Partial<CloudState>) => void;
}

export const useCloud = create<CloudState>((set) => ({
  configured: cloudConfigured,
  ready: !cloudConfigured,
  user: null,
  syncStatus: 'idle',
  google: 'unknown',
  patch: (changes) => set(changes),
}));
