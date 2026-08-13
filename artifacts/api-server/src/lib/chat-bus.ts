/**
 * In-memory pub-sub bus for chat SSE streams.
 * Maps channelId → set of SSE response writers.
 */
import type { Response } from "express";

const subscribers = new Map<number, Set<Response>>();

export function subscribe(channelId: number, res: Response) {
  if (!subscribers.has(channelId)) subscribers.set(channelId, new Set());
  subscribers.get(channelId)!.add(res);
}

export function unsubscribe(channelId: number, res: Response) {
  subscribers.get(channelId)?.delete(res);
}

export function broadcast(channelId: number, data: unknown) {
  const subs = subscribers.get(channelId);
  if (!subs) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of subs) {
    try {
      res.write(payload);
    } catch {
      subs.delete(res);
    }
  }
}
