// Cola competitiva 1v1. Empareja por rango (victorias) y MMR (Glicko-2):
//  - Al principio solo con tu mismo rango y MMR cercano (±100).
//  - La ventana de MMR crece con la espera (+15 por segundo, hasta ±600).
//  - A los 20 s acepta rangos vecinos; a los 45 s, cualquier rango.
// Entre los candidatos válidos elige el de MMR más cercano, y prioriza a quien más lleva esperando.
import type { Identity, QueueStatus } from '../../shared/types.js';

export interface QueueEntry {
  playerId: string;
  socketId: string;
  identity: Identity;
  nickname: string;
  mmr: number;
  tier: number; // índice del rango (0 Aprendiz … 4 Melófano)
  since: number;
}

export const BASE_WINDOW = 100;
export const WINDOW_GROWTH = 15; // MMR por segundo de espera
export const MAX_WINDOW = 600;
export const NEIGHBOR_TIER_AFTER = 20_000;
export const ANY_TIER_AFTER = 45_000;

export const mmrWindow = (waitedMs: number) => Math.min(MAX_WINDOW, BASE_WINDOW + WINDOW_GROWTH * Math.floor(waitedMs / 1000));
export function tierGap(waitedMs: number) {
  if (waitedMs >= ANY_TIER_AFTER) return Infinity;
  if (waitedMs >= NEIGHBOR_TIER_AFTER) return 1;
  return 0;
}

export function compatible(a: QueueEntry, b: QueueEntry, now: number): boolean {
  if (a.playerId === b.playerId) return false;
  const wa = now - a.since, wb = now - b.since;
  // Ambos tienen que aceptar al otro: se usa la ventana más estrecha de los dos.
  const win = Math.min(mmrWindow(wa), mmrWindow(wb));
  const gap = Math.min(tierGap(wa), tierGap(wb));
  return Math.abs(a.mmr - b.mmr) <= win && Math.abs(a.tier - b.tier) <= gap;
}

export class Matchmaker {
  private queue = new Map<string, QueueEntry>();

  constructor(
    private onMatch: (a: QueueEntry, b: QueueEntry) => void,
    private notify: (socketId: string, status: QueueStatus) => void,
  ) {}

  join(e: QueueEntry) {
    const prev = this.queue.get(e.playerId);
    this.queue.set(e.playerId, prev ? { ...e, since: prev.since } : e);
    this.tick(Date.now());
  }
  leave(playerId: string) {
    const e = this.queue.get(playerId);
    if (!e) return;
    this.queue.delete(playerId);
    this.notify(e.socketId, { searching: false, since: e.since, queued: this.queue.size });
  }
  leaveSocket(socketId: string) {
    for (const e of this.queue.values()) if (e.socketId === socketId) this.queue.delete(e.playerId);
  }
  has(playerId: string) { return this.queue.has(playerId); }
  size() { return this.queue.size; }

  /** Busca parejas; se llama cada segundo y al entrar alguien en la cola. */
  tick(now: number) {
    const waiting = [...this.queue.values()].sort((x, y) => x.since - y.since);
    const taken = new Set<string>();
    for (const a of waiting) {
      if (taken.has(a.playerId)) continue;
      let best: QueueEntry | null = null;
      for (const b of waiting) {
        if (taken.has(b.playerId) || !compatible(a, b, now)) continue;
        if (!best || Math.abs(a.mmr - b.mmr) < Math.abs(a.mmr - best.mmr)) best = b;
      }
      if (best) {
        taken.add(a.playerId);
        taken.add(best.playerId);
        this.queue.delete(a.playerId);
        this.queue.delete(best.playerId);
        this.onMatch(a, best);
      }
    }
    for (const e of this.queue.values()) {
      this.notify(e.socketId, { searching: true, since: e.since, queued: this.queue.size }); // sin MMR: es secreto
    }
  }
}
