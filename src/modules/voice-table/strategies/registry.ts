import { VoiceTableStrategy } from './strategy.types';
import { voiceIvrStrategy } from './voice-ivr.strategy';
import { voiceOpStrategy } from './voice-op.strategy';
import { voiceDmOpStrategy } from './voice-dm-op.strategy';

const STRATEGIES: VoiceTableStrategy[] = [
  voiceIvrStrategy,
  voiceOpStrategy,
  voiceDmOpStrategy,
];

export function resolveStrategy(url: string): VoiceTableStrategy | null {
  return STRATEGIES.find((s) => s.matchUrl(url)) ?? null;
}

export function extractMid(url: string): number | null {
  try {
    const u = new URL(url);
    const mid = u.searchParams.get('mid');
    if (!mid) return null;
    const n = parseInt(mid, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function ensurePageIdParam(url: string, pageId: number): string {
  try {
    const u = new URL(url);
    u.searchParams.set('pageID', String(pageId));
    return u.toString();
  } catch {
    return url;
  }
}

export { voiceIvrStrategy, voiceOpStrategy, voiceDmOpStrategy };
