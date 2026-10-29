// JSON cache in Forge KVS with TTL. Values larger than one KVS value (240 KiB) are split into string
// chunks (`cache:<key>#<i>`) with a small header at `cache:<key>`.
import { kvs } from '@forge/kvs';
import { log } from '../util/log';

const CHUNK_CHARS = 180_000;
const MAX_CHUNKS = 20;

interface Header { chunks: number }

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    const header = await kvs.get<Header>(`cache:${key}`);
    if (!header || typeof header.chunks !== 'number') return undefined;
    let json = '';
    for (let i = 0; i < header.chunks; i++) {
      const part = await kvs.get<string>(`cache:${key}#${i}`);
      if (part === undefined) return undefined; // a chunk expired first: treat as a miss
      json += part;
    }
    return JSON.parse(json) as T;
  } catch (err) {
    log.error(`cache read failed for ${key}`, err);
    return undefined;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlMinutes: number): Promise<boolean> {
  const json = JSON.stringify(value);
  const chunks = Math.max(1, Math.ceil(json.length / CHUNK_CHARS));
  if (chunks > MAX_CHUNKS) {
    log.error(`cache skip: ${key} is ${json.length} chars (> ${MAX_CHUNKS} chunks); it will be rebuilt on each call`);
    return false;
  }
  const ttl = { ttl: { value: ttlMinutes, unit: 'MINUTES' as const } };
  try {
    for (let i = 0; i < chunks; i++) await kvs.set(`cache:${key}#${i}`, json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS), ttl);
    await kvs.set(`cache:${key}`, { chunks } satisfies Header, ttl);
    return true;
  } catch (err) {
    log.error(`cache write failed for ${key}`, err);
    return false;
  }
}

/** Removes a cached value (header only: chunks expire on their own TTL and are unreachable without it). */
export async function cacheDelete(key: string): Promise<void> {
  try {
    await kvs.delete(`cache:${key}`);
  } catch (err) {
    log.error(`cache delete failed for ${key}`, err);
  }
}
