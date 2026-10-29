// Jira admin page (F5): health score + trend, findings, scan control, access check, audit log.
// UI Kit only (@forge/react components). All data comes from the admin resolver.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, DynamicTable, Form, FormFooter, FormSection, Heading, Inline, Label, LineChart, Lozenge, SectionMessage,
  Spinner, Stack, Tab, TabList, TabPanel, Tabs, Text, Textfield, useForm,
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

function Overview({ data, onScan, scanning }: { data: Dashboard; onScan: () => void; scanning: boolean }) {
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
      {data.scan?.status === 'failed' && <SectionMessage appearance="warning" title="Last scan failed"><Text>{data.scan.error ?? 'unknown error'}</Text></SectionMessage>}
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
    setResult(await call<ApiResult<Partial<Verdict>>>('checkAccess', { ...v }));
    setBusy(false);
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
      {v && (
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
      )}
    </Stack>
  );
}

function AuditLog() {
  const [rows, setRows] = useState<AuditRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void call<ApiResult<{ records: AuditRecord[] }>>('getAudit').then((r) => (r.ok ? setRows(r.records) : setError(r.error?.message ?? 'error')));
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
  const load = useCallback(async () => setData(await call<ApiResult<Dashboard>>('getDashboard')), []);
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
    await call('runScan');
    await load();
    setScanning(false);
  };
  if (!data) return <Spinner label="Loading Config Doctor" />;
  if (!data.ok) return <ErrorBox message={data.error?.message ?? 'Unknown error'} />;
  return (
    <Stack space="space.300">
      <Text>Deterministic, auditable diagnostics for Jira access and configuration. Read-only: Config Doctor never changes your configuration.</Text>
      <Tabs id="config-doctor-tabs">
        <TabList>
          <Tab>Overview</Tab>
          <Tab>Findings ({data.findings.length})</Tab>
          <Tab>Check access</Tab>
          <Tab>Audit log</Tab>
        </TabList>
        <TabPanel><Box paddingBlock="space.200"><Overview data={data} onScan={onScan} scanning={scanning} /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><Findings findings={data.findings} /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><AccessCheck /></Box></TabPanel>
        <TabPanel><Box paddingBlock="space.200"><AuditLog /></Box></TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
