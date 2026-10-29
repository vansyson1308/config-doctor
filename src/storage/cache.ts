// Small JSON cache in Forge KVS with TTL. Values must stay under the 240 KiB KVS limit; oversized
// values are skipped (logged) rather than failing the caller.
import { kvs } from '@forge/kvs';
import { log } from '../util/log';

const MAX_BYTES = 230 * 1024;

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  try {
    return await kvs.get<T>(`cache:${key}`);
  } catch (err) {
    log.error(`cache read failed for ${key}`, err);
    return undefined;
  }
}

export async function cacheSet<T>(key: string, value: T, ttlMinutes: number): Promise<boolean> {
  const size = Buffer.byteLength(JSON.stringify(value));
  if (size > MAX_BYTES) {
    log.info('cache skip: value too large', { key, size });
    return false;
  }
  try {
    await kvs.set(`cache:${key}`, value, { ttl: { value: ttlMinutes, unit: 'MINUTES' } });
    return true;
  } catch (err) {
    log.error(`cache write failed for ${key}`, err);
    return false;
  }
}
