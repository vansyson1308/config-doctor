// Chunked sprawl scan on Forge async events, progress in KVS. Steps run asApp (no user context);
// consecutive steps share one invocation for up to SLICE_MS, well below the 600 s consumer timeout.
import { Queue } from '@forge/events';
import { kvs } from '@forge/kvs';
import type { IndexedProject } from '../core/siteIndex';
import { audit, type ConfigData, type FieldInfo, type GroupInfo, type SchemeUse } from '../core/sprawl';
import { groupReferenceIndex, type SchemesPart, type SecurityPart } from '../core/references';
import { saveSnapshot } from '../storage/snapshots';
import { storeSiteIndex } from '../jira/siteIndexLoader';
import { loadAllSchemes } from '../jira/siteIndexLoader';
import { writeAudit } from '../storage/audit';
import { log } from '../util/log';
import {
  collectFields, collectGroups, collectPermissionSchemes, collectProjects, collectScreens, collectSecuritySchemes,
  collectWorkflowSchemes, collectWorkflows, countGroupMembers,
} from './collectors';

export const STEPS = ['fields', 'groups', 'groupCounts', 'projects', 'permissionSchemes', 'securitySchemes', 'workflowSchemes', 'workflows', 'screens', 'finalize'] as const;
export type Step = (typeof STEPS)[number];

export interface ScanState {
  id: string;
  status: 'running' | 'done' | 'failed';
  trigger: 'rovo' | 'mcp' | 'admin-page' | 'scheduler';
  requestedBy: string | null;
  startedAt: string;
  finishedAt?: string;
  step: Step;
  stepIndex: number;
  error?: string;
  /** Updated after every step; a scan with no heartbeat for STALE_AFTER_MS is treated as dead. */
  heartbeatAt?: string;
}

interface ScanEvent extends Record<string, unknown> { jobId: string; step: Step; offset?: number }

const queue = new Queue({ key: 'scan-queue' });
const STATE_KEY = 'scan:state';
const PART_TTL = { value: 2, unit: 'DAYS' } as const;
const GROUP_CHUNK = 150;
const PROJECT_CHUNK = 60;
const STALE_AFTER_MS = 12 * 60_000; // > 600 s consumer timeout + queue latency
const PART_CHUNK_CHARS = 180_000;

const partKey = (id: string, name: string) => `scanpart:${id}:${name}`;

export async function getScanState(): Promise<ScanState | undefined> {
  return kvs.get<ScanState>(STATE_KEY);
}

export function isRunning(s: ScanState | undefined, now = Date.now()): boolean {
  return !!s && s.status === 'running' && now - Date.parse(s.heartbeatAt ?? s.startedAt) < STALE_AFTER_MS;
}

async function push(body: ScanEvent): Promise<void> {
  await queue.push({ body, concurrency: { key: 'sprawl-scan', limit: 1 } });
}

/** Starts a scan unless one is already running; returns the current state. */
export async function startScan(trigger: ScanState['trigger'], requestedBy: string | null): Promise<{ state: ScanState; started: boolean }> {
  const current = await getScanState();
  if (isRunning(current)) return { state: current!, started: false };
  const now = new Date().toISOString();
  const state: ScanState = { id: `scan-${Date.now()}`, status: 'running', trigger, requestedBy, startedAt: now, heartbeatAt: now, step: 'fields', stepIndex: 0 };
  await kvs.set(STATE_KEY, state);
  await push({ jobId: state.id, step: 'fields' });
  return { state, started: true };
}

/** Parts are stored as JSON split into ≤180 KB string chunks, so large sites never hit the KVS value limit. */
async function savePart<T>(jobId: string, name: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  const chunks = Math.max(1, Math.ceil(json.length / PART_CHUNK_CHARS));
  for (let i = 0; i < chunks; i++) {
    await kvs.set(partKey(jobId, `${name}#${i}`), json.slice(i * PART_CHUNK_CHARS, (i + 1) * PART_CHUNK_CHARS), { ttl: PART_TTL });
  }
  await kvs.set(partKey(jobId, name), { chunks }, { ttl: PART_TTL });
}

async function readPart<T>(jobId: string, name: string): Promise<T> {
  const meta = await kvs.get<{ chunks: number }>(partKey(jobId, name));
  if (meta === undefined) throw new Error(`scan part ${name} missing`);
  let json = '';
  for (let i = 0; i < meta.chunks; i++) json += (await kvs.get<string>(partKey(jobId, `${name}#${i}`))) ?? '';
  return JSON.parse(json) as T;
}

async function readChunks<T>(jobId: string, name: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i++) {
    const meta = await kvs.get<{ chunks: number }>(partKey(jobId, `${name}:${i}`));
    if (meta === undefined) return out;
    out.push(...(await readPart<T[]>(jobId, `${name}:${i}`)));
  }
}

interface Position { step: Step; offset?: number }

async function advance(state: ScanState, next: Step, offset?: number): Promise<Position> {
  await kvs.set(STATE_KEY, { ...state, step: next, stepIndex: STEPS.indexOf(next), heartbeatAt: new Date().toISOString() });
  return { step: next, ...(offset !== undefined ? { offset } : {}) };
}

interface GroupsPart { groups: GroupInfo[]; productAccessGroups: string[] }

/** Runs one step; returns the next position, or null when the scan is complete. */
async function runStep(state: ScanState, step: Step, offset = 0, deadlineMs: number): Promise<Position | null> {
  const id = state.id;
  switch (step) {
    case 'fields':
      await savePart(id, 'fields', await collectFields());
      return advance(state, 'groups');
    case 'groups':
      await savePart(id, 'groups', await collectGroups());
      return advance(state, 'groupCounts', 0);
    case 'groupCounts': {
      const { groups } = await readPart<GroupsPart>(id, 'groups');
      const chunk = groups.slice(offset, offset + GROUP_CHUNK);
      await savePart(id, `groupCounts:${offset / GROUP_CHUNK}`, await countGroupMembers(chunk));
      return offset + GROUP_CHUNK < groups.length ? advance(state, 'groupCounts', offset + GROUP_CHUNK) : advance(state, 'projects', 0);
    }
    case 'projects': {
      const r = await collectProjects(offset, PROJECT_CHUNK);
      await savePart(id, `projects:${offset / PROJECT_CHUNK}`, r.projects);
      await savePart(id, `projectGaps:${offset / PROJECT_CHUNK}`, r.gaps);
      if (offset === 0) await savePart(id, 'projectsTotal', r.total);
      return offset + PROJECT_CHUNK < r.total ? advance(state, 'projects', offset + PROJECT_CHUNK) : advance(state, 'permissionSchemes');
    }
    case 'permissionSchemes': {
      const projects = await readChunks<IndexedProject>(id, 'projects');
      await savePart(id, 'permissionSchemes', await collectPermissionSchemes(projects));
      return advance(state, 'securitySchemes');
    }
    case 'securitySchemes':
      await savePart(id, 'securitySchemes', await collectSecuritySchemes());
      return advance(state, 'workflowSchemes');
    case 'workflowSchemes': {
      const projects = await readChunks<IndexedProject>(id, 'projects');
      const ws = await collectWorkflowSchemes(projects.map((p) => p.id).filter((x): x is string => !!x));
      await savePart(id, 'workflowSchemes', ws.schemes);
      await savePart(id, 'workflowGaps', ws.gaps);
      return advance(state, 'workflows');
    }
    case 'workflows':
      await savePart(id, 'workflows', await collectWorkflows());
      return advance(state, 'screens');
    case 'screens':
      await savePart(id, 'screens', await collectScreens());
      return advance(state, 'finalize');
    case 'finalize':
      await finalize(state);
      return null;
  }
}

async function finalize(state: ScanState): Promise<void> {
  const id = state.id;
  const fields = await readPart<FieldInfo[]>(id, 'fields');
  const groupsPart = await readPart<GroupsPart>(id, 'groups');
  const counted = await readChunks<GroupInfo>(id, 'groupCounts');
  const projects = await readChunks<IndexedProject>(id, 'projects');
  const projectsTotal = await readPart<number>(id, 'projectsTotal');
  const schemes = await readPart<SchemesPart>(id, 'permissionSchemes');
  const security = await readPart<SecurityPart>(id, 'securitySchemes');
  const data: ConfigData = {
    scannedAt: new Date().toISOString(),
    fields,
    groups: counted.length ? counted : groupsPart.groups,
    groupReferences: groupReferenceIndex({ projects, schemes, security, productAccessGroups: groupsPart.productAccessGroups }),
    groupGrants: schemes.grants,
    permissionSchemes: schemes.schemes,
    securitySchemes: security.schemes,
    workflowSchemes: await readPart<SchemeUse[]>(id, 'workflowSchemes'),
    workflows: await readPart(id, 'workflows'),
    screens: await readPart(id, 'screens'),
    projects: { total: projectsTotal, scanned: projects.length },
    coverageGaps: [...(await readChunks<string>(id, 'projectGaps')), ...(await readPart<string[]>(id, 'workflowGaps'))],
  };
  const result = audit(data);
  const durationMs = Date.now() - Date.parse(state.startedAt);
  await saveSnapshot({ ...result, meta: { jobId: id, trigger: state.trigger, requestedBy: state.requestedBy, durationMs } });
  // The scan also refreshes the blast-radius index used by explain-access.
  await storeSiteIndex({ builtAt: data.scannedAt, projects, schemes: await loadAllSchemes('app'), groupSizes: Object.fromEntries(data.groups.filter((g) => g.memberCount !== null).map((g) => [g.id, g.memberCount!])), productAccessGroups: groupsPart.productAccessGroups, complete: result.coverage.complete, projectsTotal, readAs: 'app' }, 24 * 60);
  await kvs.set(STATE_KEY, { ...state, status: 'done', step: 'finalize', stepIndex: STEPS.length - 1, finishedAt: new Date().toISOString() });
  await writeAudit({
    at: state.startedAt, accountId: state.requestedBy, action: 'sprawl-scan', source: state.trigger === 'scheduler' ? 'scheduler' : 'consumer',
    inputs: { jobId: id, trigger: state.trigger }, outcome: 'ok',
    summary: `health ${result.healthScore}, ${result.findings.length} findings, ${projects.length}/${projectsTotal} projects`, durationMs,
  });
  log.info('scan finished', { jobId: id, healthScore: result.healthScore, findings: result.findings.length, durationMs });
}

/** Steps run back-to-back inside one invocation until this budget is used, then continue via a new event. */
const SLICE_MS = 240_000;

/**
 * Async-event consumer. Runs consecutive scan steps until the time slice is used (queue latency is
 * ~20 s per event, so chaining in-process is much faster), then pushes a continuation event.
 */
export async function scanWorker(event: { body: ScanEvent }): Promise<void> {
  const started = Date.now();
  const { jobId } = event.body;
  const state = await getScanState();
  if (!state || state.id !== jobId || state.status !== 'running') {
    log.info('stale scan event ignored', { jobId, step: event.body.step });
    return;
  }
  let pos: Position | null = { step: event.body.step, ...(event.body.offset !== undefined ? { offset: event.body.offset } : {}) };
  try {
    while (pos) {
      if (Date.now() - started > SLICE_MS) {
        await push({ jobId, step: pos.step, ...(pos.offset !== undefined ? { offset: pos.offset } : {}) });
        log.info('scan continues in a new event', { jobId, step: pos.step });
        return;
      }
      const stepStarted = Date.now();
      const current: Position = pos;
      pos = await runStep({ ...state, step: current.step, stepIndex: STEPS.indexOf(current.step) }, current.step, current.offset ?? 0, started + 500_000);
      log.info('scan step done', { jobId, step: current.step, offset: current.offset ?? 0, ms: Date.now() - stepStarted });
    }
  } catch (err) {
    const step = pos?.step ?? 'unknown';
    log.error(`scan step ${step} failed`, err);
    const message = err instanceof Error ? err.message.slice(0, 300) : 'unknown error';
    await kvs.set(STATE_KEY, { ...state, status: 'failed', error: `${step}: ${message}`, finishedAt: new Date().toISOString() });
    await writeAudit({ at: state.startedAt, accountId: state.requestedBy, action: 'sprawl-scan', source: 'consumer', inputs: { jobId, step }, outcome: 'error', summary: `failed at ${step}: ${message}`, durationMs: Date.now() - Date.parse(state.startedAt) });
  }
}

/** Weekly scheduled trigger (F4). */
export async function weeklyScan(): Promise<void> {
  const { started, state } = await startScan('scheduler', null);
  log.info('weekly scan trigger', { started, jobId: state.id });
}
