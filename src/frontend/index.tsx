// Jira admin page (F5): health score + trend, findings, scan control, access check, audit log.
// UI Kit only (@forge/react components). All data comes from the admin resolver.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, DynamicTable, Form, FormFooter, FormSection, Heading, Inline, Label, LineChart, Lozenge, SectionMessage,
  Select, Spinner, Stack, Tab, TabList, TabPanel, Tabs, Text, Textfield, useForm,
} from '@forge/react';
import { invoke } from '@forge/bridge';

/** invoke() without rate-limit metadata returns the resolver's value as-is. */
async function call<T>(key: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await invoke<T>(key, payload)) as T;
}

type Risk = 'low' | 'medium' | 'high';
type ApiResult<T> = { ok: boolean; error?: { kind: string; message: string } } & T;
interface Finding { id: string; rule: string; title: string; risk: Risk; effort: Risk; recommendation: string; evidence: string; isNew: boolean }
interface Dashboard {
  scan: { status: string; startedAt: string; finishedAt: string | null; progress: string; trigger: string; error: string | null } | null;
  summary: {
    scannedAt: string; healthScore: number; previousScore: number | null; totalFindings: number; newSinceLastScan: number;
    coverage: { projectsScanned: number; projectsTotal: number; complete: boolean };
    breakdown: Array<{ category: string; weight: number; affected: number; total: number; penalty: number }>;
  } | null;
  findings: Finding[];
  trend: Array<{ date: string; score: number; series: string }>;
}
interface AuditRecord { at: string; accountId: string | null; action: string; source: string; outcome: string; summary: string; durationMs: number }
interface Verdict {
  verdict: string; permission: string; blockingLayer: string | null; groundTruthCheck: string;
  user: { displayName: string }; project: { key: string }; issue?: { key: string; securityLevel: string | null };
  evidence: Array<{ layer: string; grant: string; userMatches: boolean | string; via: string; level?: string; scheme?: string }>;
  fixOptions: Array<{ action: string; risk: Risk; resolves: boolean; alsoGrants: string }>;
  notes: string[];
}

const riskLozenge = (r: Risk) => <Lozenge appearance={r === 'high' ? 'removed' : r === 'medium' ? 'moved' : 'default'}>{r}</Lozenge>;
const scoreAppearance = (s: number) => (s >= 80 ? 'success' : s >= 60 ? 'moved' : 'removed');

function ErrorBox({ message }: { message: string }) {
  return <SectionMessage appearance="error" title="Config Doctor"><Text>{message}</Text></SectionMessage>;
}

function Overview({ data, onScan, scanning, onChanged }: { data: Dashboard; onScan: () => void; scanning: boolean; onChanged: () => void }) {
  const s = data.summary;
  return (
    <Stack space="space.200">
      <Inline space="space.200" alignBlock="center">
        {s ? <Heading size="large">Health score {s.healthScore}/100</Heading> : <Heading size="large">No scan yet</Heading>}
        {s && <Lozenge appearance={scoreAppearance(s.healthScore)} isBold>{s.healthScore >= 80 ? 'healthy' : s.healthScore >= 60 ? 'needs attention' : 'sprawling'}</Lozenge>}
        <Button appearance="primary" onClick={onScan} isDisabled={scanning || data.scan?.status === 'running'}>
          {data.scan?.status === 'running' ? `Scanning… ${data.scan.progress}` : 'Run scan now'}
        </Button>
      </Inline>
      {s && (
        <Text>
          Last scan {s.scannedAt.slice(0, 16).replace('T', ' ')} UTC · {s.totalFindings} findings · {s.newSinceLastScan} new since previous scan
          {s.previousScore !== null ? ` · previous score ${s.previousScore}` : ''} · coverage {s.coverage.projectsScanned}/{s.coverage.projectsTotal} projects
        </Text>
      )}
      {!s && (
        <SectionMessage appearance="information" title="Getting started">
          <Text>New site with little configuration? Click Create demo lab below for a realistic scenario to explore, then Run scan now (usually 10–60 seconds). Check access and Impact preview work immediately. With Rovo, open Ask Rovo and pick the Config Doctor agent.</Text>
        </SectionMessage>
      )}
      {data.scan?.status === 'failed' &&<SectionMessage appearance="warning" title="Last scan failed"><Text>{data.scan.error ?? 'unknown error'}</Text></SectionMessage>}
      {data.trend.length > 1 && <LineChart data={data.trend} xAccessor="date" yAccessor="score" colorAccessor="series" title="Health score trend" height={260} />}
      {s && (
        <DynamicTable
          caption="Where the points go (score = 100 − penalties)"
          head={{ cells: [{ key: 'c', content: 'Category' }, { key: 'a', content: 'Affected' }, { key: 'w', content: 'Weight' }, { key: 'p', content: 'Penalty' }] }}
          rows={s.breakdown.map((b) => ({ key: b.category, cells: [
            { key: 'c', content: b.category }, { key: 'a', content: `${b.affected} / ${b.total}` }, { key: 'w', content: String(b.weight) }, { key: 'p', content: `−${b.penalty}` },
          ] }))}
        />
      )}
      <DemoLab onScan={onScan} onChanged={onChanged} />
    </Stack>
  );
}

function Findings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <Text>No findings yet. Run a scan.</Text>;
  return (
    <DynamicTable
      caption={`${findings.length} findings, ranked by risk then effort`}
      rowsPerPage={20}
      head={{ cells: [{ key: 'r', content: 'Risk' }, { key: 'e', content: 'Effort' }, { key: 't', content: 'Finding' }, { key: 'rec', content: 'Recommendation' }, { key: 'id', content: 'ID' }] }}
      rows={findings.map((f) => ({ key: f.id, cells: [
        { key: 'r', content: riskLozenge(f.risk) },
        { key: 'e', content: f.effort },
        { key: 't', content: <Stack space="space.050"><Text>{f.title}{f.isNew ? ' 🆕' : ''}</Text><Text size="small">{f.evidence}</Text></Stack> },
        { key: 'rec', content: f.recommendation },
        { key: 'id', content: f.id },
      ] }))}
    />
  );
}

function AccessCheck() {
  const { handleSubmit, register, getFieldId } = useForm<{ user: string; target: string; permission: string }>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult<Partial<Verdict>> | null>(null);
  const submit = async (v: { user: string; target: string; permission: string }) => {
    setBusy(true);
    try {
      setResult(await call<ApiResult<Partial<Verdict>>>('checkAccess', { ...v }));
    } catch (err) {
      setResult({ ok: false, error: { kind: 'error', message: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      setBusy(false);
    }
  };
  const v = result?.ok ? (result as unknown as Verdict) : null;
  return (
    <Stack space="space.200">
      <Form onSubmit={handleSubmit(submit)}>
        <FormSection>
          <Inline space="space.200" shouldWrap>
            <Box><Label labelFor={getFieldId('user')}>User</Label><Textfield {...register('user', { required: true })} placeholder="Emma Paris" /></Box>
            <Box><Label labelFor={getFieldId('target')}>Issue or project key</Label><Textfield {...register('target', { required: true })} placeholder="PAY-3" /></Box>
            <Box><Label labelFor={getFieldId('permission')}>Permission (optional)</Label><Textfield {...register('permission')} placeholder="see, edit, transition…" /></Box>
          </Inline>
        </FormSection>
        <FormFooter align="start"><Button appearance="primary" type="submit" isDisabled={busy}>{busy ? 'Checking…' : 'Explain access'}</Button></FormFooter>
      </Form>
      {result && !result.ok && <ErrorBox message={result.error?.message ?? 'Unknown error'} />}
      {v && <VerdictView v={v} />}
    </Stack>
  );
}

interface Viewers {
  issue: { key: string; securityLevel: string | null }; viewerCount: number;
  viewers: Array<{ displayName: string; paths: string[] }>;
  groundTruth: { check: string; jiraCount?: number; onlyJiraSees?: string[]; onlyModelSees?: string[] };
  notes: string[];
}

// Text inputs use useForm/register (uncontrolled): controlled value/onChange races across the UI Kit bridge.
function WhoCanSee() {
  const { handleSubmit, register, getFieldId } = useForm<{ issueKey: string }>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult<Partial<Viewers>> | null>(null);
  const run = async (v: { issueKey: string }) => {
    setBusy(true);
    try {
      setResult(await call<ApiResult<Partial<Viewers>>>('whoCanSee', { issueKey: v.issueKey }));
    } catch (err) {
      setResult({ ok: false, error: { kind: 'error', message: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      setBusy(false);
    }
  };
  const v = result?.ok ? (result as unknown as Viewers) : null;
  return (
    <Stack space="space.150">
      <Heading size="small">Who can see an issue?</Heading>
      <Form onSubmit={handleSubmit(run)}>
        <FormSection>
          <Box><Label labelFor={getFieldId('issueKey')}>Issue key</Label><Textfield {...register('issueKey', { required: true })} placeholder="PAY-3" /></Box>
        </FormSection>
        <FormFooter align="start"><Button appearance="primary" type="submit" isDisabled={busy}>{busy ? 'Checking…' : 'List viewers'}</Button></FormFooter>
      </Form>
      {result && !result.ok && <ErrorBox message={result.error?.message ?? 'Unknown error'} />}
      {v && <ViewersView v={v} />}
    </Stack>
  );
}

interface Impact {
  change: string; risk: Risk; summary: string; references: string[]; notes: string[]; undetermined: string[];
  projects: Array<{ project: string; loses: Record<string, string[]>; gains: Record<string, string[]>; keepsAccess: Array<{ user: string; via: string }> }>;
}

const CHANGE_TYPES = [
  { label: 'Remove a group', value: 'remove-group' },
  { label: 'Delete a custom field', value: 'delete-field' },
  { label: "Switch a project's permission scheme", value: 'switch-permission-scheme' },
];

function ImpactPreview() {
  const { handleSubmit, register, getFieldId } = useForm<{ target: string; newScheme: string }>();
  const [changeType, setChangeType] = useState<{ label: string; value: string }>(CHANGE_TYPES[0]!);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResult<Partial<Impact>> | null>(null);
  const isSwitch = changeType.value === 'switch-permission-scheme';
  const run = async (v: { target: string; newScheme: string }) => {
    setBusy(true);
    try {
      setResult(await call<ApiResult<Partial<Impact>>>('previewImpact', { changeType: changeType.value, target: v.target, ...(isSwitch ? { newScheme: v.newScheme } : {}) }));
    } catch (err) {
      setResult({ ok: false, error: { kind: 'error', message: err instanceof Error ? err.message : 'Request failed' } });
    } finally {
      setBusy(false);
    }
  };
  const r = result?.ok ? (result as unknown as Impact) : null;
  return (
    <Stack space="space.200">
      <Text>Simulate a change before you make it. Read-only: nothing is changed in Jira.</Text>
      <Form onSubmit={handleSubmit(run)}>
        <FormSection>
          <Inline space="space.200" shouldWrap>
            <Box><Label labelFor="imp-type">Change</Label><Select inputId="imp-type" options={CHANGE_TYPES} defaultValue={CHANGE_TYPES[0]} onChange={(o: { label: string; value: string }) => setChangeType(o)} /></Box>
            <Box><Label labelFor={getFieldId('target')}>{changeType.value === 'remove-group' ? 'Group name' : changeType.value === 'delete-field' ? 'Field name or id' : 'Project key'}</Label><Textfield {...register('target', { required: true })} /></Box>
            {isSwitch && <Box><Label labelFor={getFieldId('newScheme')}>New permission scheme</Label><Textfield {...register('newScheme')} /></Box>}
          </Inline>
        </FormSection>
        <FormFooter align="start"><Button appearance="primary" type="submit" isDisabled={busy}>{busy ? 'Simulating…' : 'Preview impact'}</Button></FormFooter>
      </Form>
      {result && !result.ok && <ErrorBox message={result.error?.message ?? 'Unknown error'} />}
      {r && <ImpactView r={r} />}
    </Stack>
  );
}

function VerdictView({ v }: { v: Verdict }) {
  return (
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={v.verdict === 'HAS_ACCESS' ? 'success' : v.verdict === 'NO_ACCESS' ? 'removed' : 'moved'} isBold>{v.verdict}</Lozenge>
          <Text>{v.user.displayName} · {v.permission} · {v.issue?.key ?? v.project.key}{v.blockingLayer ? ` · blocked by ${v.blockingLayer}` : ''} · Jira check: {v.groundTruthCheck}</Text>
        </Inline>
        <DynamicTable
          caption="Evidence chain"
          head={{ cells: [{ key: 'l', content: 'Layer' }, { key: 'g', content: 'Grant / member' }, { key: 'm', content: 'Matches' }, { key: 'v', content: 'Why' }] }}
          rows={v.evidence.map((e, i) => ({ key: String(i), cells: [
            { key: 'l', content: e.layer === 'ISSUE_SECURITY' ? `Security level ${e.level ?? ''}` : e.layer === 'PERMISSION_SCHEME' ? `Scheme ${e.scheme ?? ''}` : e.layer },
            { key: 'g', content: e.grant },
            { key: 'm', content: e.userMatches === true ? <Lozenge appearance="success">yes</Lozenge> : e.userMatches === false ? <Lozenge appearance="removed">no</Lozenge> : <Lozenge>{String(e.userMatches)}</Lozenge> },
            { key: 'v', content: e.via },
          ] }))}
        />
        {v.fixOptions.length > 0 && (
          <DynamicTable
            caption="Fix options (simulated; nothing is changed)"
            head={{ cells: [{ key: 'a', content: 'Action' }, { key: 'r', content: 'Risk' }, { key: 's', content: 'Resolves' }, { key: 'b', content: 'Blast radius' }] }}
            rows={v.fixOptions.map((f, i) => ({ key: String(i), cells: [
              { key: 'a', content: f.action }, { key: 'r', content: riskLozenge(f.risk) }, { key: 's', content: f.resolves ? 'yes' : 'not alone' }, { key: 'b', content: f.alsoGrants },
            ] }))}
          />
        )}
        {v.notes.map((n) => <Text key={n}>ℹ️ {n}</Text>)}
      </Stack>
  );
}

function ViewersView({ v }: { v: Viewers }) {
  return (
      <Stack space="space.100">
        <Text>{v.viewerCount} viewer(s) of {v.issue.key}{v.issue.securityLevel ? ` (security level "${v.issue.securityLevel}")` : ''} · Jira check: {v.groundTruth.check}</Text>
        <DynamicTable
          head={{ cells: [{ key: 'u', content: 'Person' }, { key: 'p', content: 'Access path(s)' }] }}
          rows={v.viewers.map((x, i) => ({ key: String(i), cells: [{ key: 'u', content: x.displayName }, { key: 'p', content: x.paths.join(' · ') }] }))}
        />
        {v.notes.map((n) => <Text key={n}>ℹ️ {n}</Text>)}
      </Stack>
  );
}

function ImpactView({ r }: { r: Impact }) {
  return (
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center"><Text>{r.change}</Text>{riskLozenge(r.risk)}</Inline>
        <Text>{r.summary}</Text>
        {r.projects.length > 0 && (
          <DynamicTable
            head={{ cells: [{ key: 'p', content: 'Project' }, { key: 'l', content: 'Would lose' }, { key: 'g', content: 'Would gain' }, { key: 'k', content: 'Keeps access via' }] }}
            rows={r.projects.map((p) => ({ key: p.project, cells: [
              { key: 'p', content: p.project },
              { key: 'l', content: Object.entries(p.loses).map(([perm, who]) => `${perm}: ${who.join(', ')}`).join(' · ') || '—' },
              { key: 'g', content: Object.entries(p.gains).map(([perm, who]) => `${perm}: ${who.join(', ')}`).join(' · ') || '—' },
              { key: 'k', content: p.keepsAccess.map((k) => `${k.user} (${k.via})`).join(' · ') || '—' },
            ] }))}
          />
        )}
        {r.references.length > 0 && <Text>References: {r.references.join(' · ')}</Text>}
        {r.notes.map((n) => <Text key={n}>ℹ️ {n}</Text>)}
      </Stack>
  );
}

interface LabObject { type: string; id: string; name: string }
interface LabStatus { state: { status: string; objects: LabObject[]; error?: string; updatedAt?: string }; tryThese: Array<{ label: string; kind: 'access' | 'viewers' | 'impact' | 'scan'; args: Record<string, string> }> }
interface LabPreview { mode: 'create' | 'remove'; token: string; lines: string[] }
interface LabRun { done: boolean; status: string; log: string[] }

/** Try-these card: ready-made questions that work on this site because the lab created their objects. */
function TryThese({ items, onScan }: { items: LabStatus['tryThese']; onScan: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<{ kind: string; data: ApiResult<Record<string, unknown>> } | null>(null);
  const ask = async (t: LabStatus['tryThese'][number]) => {
    if (t.kind === 'scan') { onScan(); return; }
    setBusy(t.label);
    try {
      const fn = t.kind === 'access' ? 'checkAccess' : t.kind === 'viewers' ? 'whoCanSee' : 'previewImpact';
      setOut({ kind: t.kind, data: await call<ApiResult<Record<string, unknown>>>(fn, t.args) });
    } catch (err) {
      setOut({ kind: t.kind, data: { ok: false, error: { kind: 'error', message: err instanceof Error ? err.message : 'Request failed' } } });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Stack space="space.150">
      <Heading size="small">Try these (they work on this site)</Heading>
      <Inline space="space.100" shouldWrap>
        {items.map((t) => <Button key={t.label} onClick={() => void ask(t)} isDisabled={busy !== null}>{busy === t.label ? 'Working…' : t.label}</Button>)}
      </Inline>
      {out && !out.data.ok && <ErrorBox message={out.data.error?.message ?? 'Unknown error'} />}
      {out?.data.ok && out.kind === 'access' && <VerdictView v={out.data as unknown as Verdict} />}
      {out?.data.ok && out.kind === 'viewers' && <ViewersView v={out.data as unknown as Viewers} />}
      {out?.data.ok && out.kind === 'impact' && <ImpactView r={out.data as unknown as Impact} />}
    </Stack>
  );
}

function DemoLab({ onScan, onChanged }: { onScan: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<ApiResult<LabStatus> | null>(null);
  const [preview, setPreview] = useState<ApiResult<LabPreview> | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setStatus(await call<ApiResult<LabStatus>>('labStatus')); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const ask = async (mode: 'create' | 'remove') => {
    setError(null);
    const r = await call<ApiResult<LabPreview>>('labPreview', { mode });
    if (!r.ok) setError(r.error?.message ?? 'Could not prepare the preview');
    setPreview(r.ok ? r : null);
  };
  const confirm = async () => {
    if (!preview?.ok) return;
    setRunning(preview.mode === 'create' ? 'Creating demo lab…' : 'Removing demo lab…');
    setError(null);
    try {
      let r = await call<ApiResult<LabRun>>('labRun', { token: preview.token });
      setPreview(null);
      // Each call is one time slice; keep going until the run reports done.
      for (let i = 0; r.ok && !r.done && i < 20; i++) {
        setRunning(`${r.log.at(-1) ?? 'Working'}… (step ${i + 2})`);
        r = await call<ApiResult<LabRun>>('labRun', {});
      }
      if (!r.ok) setError(r.error?.message ?? 'The demo lab run stopped');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setRunning(null);
      await load();
      onChanged();
    }
  };
  const st = status?.ok ? status.state : null;
  const ready = st?.status === 'ready';
  const partial = st && (st.status === 'creating' || st.status === 'removing' || st.status === 'failed');
  return (
    <Stack space="space.150">
      <Heading size="small">Demo lab</Heading>
      <Text>
        {ready ? `Demo lab is ready (${st!.objects.length} objects recorded). Everything it created is listed and can be removed with one click.`
          : 'Opt-in: creates a small, clearly labelled scenario (project CDLAB, cdlab- groups and role, two schemes, three issues, three near-duplicate fields) using only your account. Nothing else is changed, and "Remove demo lab" deletes only what it recorded.'}
      </Text>
      {partial && <SectionMessage appearance="warning" title={`Demo lab ${st!.status}`}><Text>{st!.error ?? 'A previous run did not finish. Run it again: finished steps are kept.'}</Text></SectionMessage>}
      <Inline space="space.100">
        {!ready && <Button appearance="primary" onClick={() => void ask('create')} isDisabled={!!running}>Create demo lab</Button>}
        {(ready || (st && st.objects.length > 0)) && <Button onClick={() => void ask('remove')} isDisabled={!!running}>Remove demo lab</Button>}
        {running && <Spinner label={running} />}
        {running && <Text>{running}</Text>}
      </Inline>
      {error && <ErrorBox message={error} />}
      {preview?.ok && (
        <SectionMessage appearance={preview.mode === 'create' ? 'information' : 'warning'} title={preview.mode === 'create' ? 'This will create:' : 'This will remove:'}>
          <Stack space="space.050">
            {preview.lines.map((l) => <Text key={l}>• {l}</Text>)}
            <Inline space="space.100">
              <Button appearance={preview.mode === 'create' ? 'primary' : 'danger'} onClick={() => void confirm()}>{preview.mode === 'create' ? 'Confirm: create demo lab' : 'Confirm: remove demo lab'}</Button>
              <Button appearance="subtle" onClick={() => setPreview(null)}>Cancel</Button>
            </Inline>
          </Stack>
        </SectionMessage>
      )}
      {ready && status?.ok && <TryThese items={status.tryThese} onScan={onScan} />}
    </Stack>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<AuditRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void call<ApiResult<{ records: AuditRecord[] }>>('getAudit')
      .then((r) => (r.ok ? setRows(r.records) : setError(r.error?.message ?? 'error')))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Request failed'));
  }, []);
  useEffect(load, [load]);
  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Spinner label="Loading audit log" />;
  return (
    <Stack space="space.100">
    <Inline><Button onClick={load}>Refresh</Button></Inline>
    <DynamicTable
      caption="Every Config Doctor action (Rovo, MCP, admin page, scheduler), newest first; kept 90 days"
      rowsPerPage={25}
      head={{ cells: [{ key: 't', content: 'When (UTC)' }, { key: 'a', content: 'Action' }, { key: 's', content: 'Source' }, { key: 'o', content: 'Outcome' }, { key: 'u', content: 'User' }, { key: 'm', content: 'Result' }, { key: 'd', content: 'ms' }] }}
      rows={rows.map((r, i) => ({ key: `${r.at}-${i}`, cells: [
        { key: 't', content: r.at.slice(0, 19).replace('T', ' ') },
        { key: 'a', content: r.action },
        { key: 's', content: r.source },
        { key: 'o', content: <Lozenge appearance={r.outcome === 'ok' ? 'success' : r.outcome === 'denied' ? 'removed' : 'moved'}>{r.outcome}</Lozenge> },
        { key: 'u', content: r.accountId ? `${r.accountId.slice(0, 10)}…` : 'system' },
        { key: 'm', content: r.summary },
        { key: 'd', content: String(r.durationMs) },
      ] }))}
    />
    </Stack>
  );
}

function App() {
  const [data, setData] = useState<ApiResult<Dashboard> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await call<ApiResult<Dashboard>>('getDashboard'));
    } catch (err) {
      setData({ ok: false, error: { kind: 'error', message: err instanceof Error ? err.message : 'Request failed' } } as ApiResult<Dashboard>);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (data?.ok && data.scan?.status === 'running') {
      const t = setTimeout(() => void load(), 10_000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [data, load]);
  const onScan = async () => {
    setScanning(true);
    setScanError(null);
    try {
      const r = await call<ApiResult<{ started: boolean }>>('runScan');
      if (!r.ok) setScanError(r.error?.message ?? 'Could not start the scan');
      await load();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Could not start the scan');
    } finally {
      setScanning(false);
    }
  };
  if (!data) return <Spinner label="Loading Config Doctor" />;
  if (!data.ok) return <ErrorBox message={data.error?.message ?? 'Unknown error'} />;
  return (
    <Stack space="space.300">
      <Text>Deterministic, auditable diagnostics for Jira access and configuration. Read-only: Config Doctor never changes your existing configuration (the opt-in demo lab below creates and removes only its own objects).</Text>
      {scanError && <ErrorBox message={scanError} />}
      <Tabs id="config-doctor-tabs">
        <TabList>
          <Tab>Overview</Tab>
          <Tab>Findings ({data.findings.length})</Tab>
          <Tab>Check access</Tab>
          <Tab>Impact preview</Tab>
          <Tab>Audit log</Tab>
        </TabList>
        <TabPanel><Box paddingBlock="space.200"><Overview data={data} onScan={onScan} scanning={scanning} onChanged={() => void load()} /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><Findings findings={data.findings} /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><Stack space="space.400"><AccessCheck /><WhoCanSee /></Stack></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><ImpactPreview /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><AuditLog /></Box></TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
