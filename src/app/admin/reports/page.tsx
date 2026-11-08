'use client';

import * as React from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Bookmark, Download, FileSpreadsheet, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { BookingStatus, ISODate } from '@/lib/dto';
import { fetcher } from '@/lib/fetcher';
import { addDays, fmtDay, formatMoney } from '@/lib/format';
import { BOOKING_STATUS, formatNumber } from '@/lib/status';
import {
  DATE_FIELD_LABEL,
  GROUP_LABEL,
  PAYMENT_METHOD_LABEL,
  REPORT_PAYMENT_METHODS,
  REPORT_PRESETS,
  REPORT_STATUSES,
  columnsFor,
  sourceLabel,
  specToQuery,
  type ReportCell,
  type ReportColumn,
  type ReportDateField,
  type ReportGroupBy,
  type ReportKind,
  type ReportPreset,
  type ReportResult,
  type ReportSpec,
} from '@/lib/reports';
import { decodeQuery, encodeQuery, type QueryResult, type ReportQuery } from '@/lib/report-query';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Callout, EmptyState, Skeleton } from '@/components/ui/primitives';
import { SegmentedControl } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConsole, usePropertyUrl } from '@/components/console/ConsoleProvider';
import { PageShell } from '@/components/console/PageShell';
import { AskReport } from '@/components/reports/AskReport';
import { ReportTable } from '@/components/reports/ReportTable';

/** A report someone saved: its filters and columns, and its dates as days from today so "last 7 days" keeps rolling. */
interface SavedReport {
  id: string;
  name: string;
  range: [number, number];
  spec: Omit<ReportSpec, 'from' | 'to'>;
  /** A described report (built from plain words) instead of the filters above. */
  query?: Omit<ReportQuery, 'from' | 'to'>;
}

/** A described report on screen: the query in its link form (?q=), and the assistant's note about it. */
interface CustomReport {
  q: string;
  note?: string | null;
}

function readQuery(q: string): ReportQuery | null {
  try {
    const v = decodeQuery(q) as ReportQuery;
    return v && typeof v === 'object' && typeof v.from === 'string' && typeof v.to === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** The page's address with or without a described report, so it can be bookmarked or shared. */
function syncAddress(q: string | null) {
  try {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* address can't change here (sandboxed): the report still shows */
  }
}

const SAVED_KEY = 'hotelone.reports.saved';

function readSaved(): SavedReport[] {
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSaved(list: SavedReport[]) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode): saved reports last for this visit only */
  }
}

const dayDiff = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

function specFrom(preset: Pick<ReportPreset, 'spec' | 'range'>, today: ISODate): ReportSpec {
  return { roomTypes: [], sources: [], ...preset.spec, from: addDays(today, preset.range[0]), to: addDays(today, preset.range[1]) };
}

function quickRanges(today: ISODate): { label: string; from: ISODate; to: ISODate }[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(monthStart, -1);
  return [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Tomorrow', from: addDays(today, 1), to: addDays(today, 1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Next 7 days', from: today, to: addDays(today, 6) },
    { label: 'This month', from: monthStart, to: addDays(`${addDays(monthStart, 32).slice(0, 8)}01`, -1) },
    { label: 'Last month', from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
  ];
}

function formatCell(v: ReportCell, col: ReportColumn, currency: string): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (col.format) {
    case 'money':
      return formatMoney(Number(v), currency, { cents: true });
    case 'number':
      return formatNumber(Number(v));
    case 'percent':
      return `${Number(v).toFixed(1)}%`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDay(String(v), 'weekday') : String(v);
    case 'datetime':
      return new Date(String(v)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    default:
      return String(v);
  }
}

/** A row of on/off chips for a multi-choice filter. Nothing picked means everything. */
function ChipFilter<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  const id = React.useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <p id={id} className="text-sm font-medium">
        {label} <span className="font-normal text-muted-foreground">{value.length ? `· ${value.length} picked` : '· all'}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25',
                on ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border-strong/50 bg-surface text-foreground hover:bg-accent',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { can, today, property, propertyId, ctx } = useConsole();
  const [presetId, setPresetId] = React.useState<string>('arrivals');
  const [title, setTitle] = React.useState('Arrivals');
  const [spec, setSpec] = React.useState<ReportSpec | null>(null);
  const [showBuilder, setShowBuilder] = React.useState(false);
  const [saved, setSaved] = React.useState<SavedReport[]>([]);
  const [custom, setCustomState] = React.useState<CustomReport | null>(null);
  const customRef = React.useRef(custom);
  customRef.current = custom;
  const { mutate: prime } = useSWRConfig();
  const setCustom = (c: CustomReport | null) => {
    setCustomState(c);
    syncAddress(c?.q ?? null);
  };

  React.useEffect(() => setSaved(readSaved()), []);
  // A link to a described report (from the agent's "Open in Reports", or one someone shared).
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q && readQuery(q)) {
      setCustomState({ q });
      setPresetId('ask');
    }
  }, []);
  // Start (and restart on a hotel switch) from the arrivals report for today.
  React.useEffect(() => {
    if (!today) return;
    setSpec(specFrom(REPORT_PRESETS[0], today));
    // A described report on screen stays (it runs for whichever hotel is picked).
    setPresetId((p) => (customRef.current || p === 'ask' ? p : 'arrivals'));
    setTitle('Arrivals');
  }, [today, property?.id]);

  const query = spec ? specToQuery(spec) : null;
  const url = usePropertyUrl('/api/admin/reports', query ?? {});
  const csvUrl = usePropertyUrl('/api/admin/reports', { ...(query ?? {}), format: 'csv', title });
  const { data, error, isLoading, isValidating, mutate } = useSWR<ReportResult>(spec && !custom ? url : null, fetcher, { keepPreviousData: true });
  const customQuery = custom ? readQuery(custom.q) : null;
  const customUrl = usePropertyUrl('/api/admin/reports/query', custom ? { q: custom.q } : {});
  const customCsv = usePropertyUrl('/api/admin/reports/query', custom ? { q: custom.q, format: 'csv' } : {});
  const described = useSWR<QueryResult>(custom ? customUrl : null, fetcher, { keepPreviousData: true });

  if (!can('reports.view')) {
    return (
      <PageShell title="Reports">
        <EmptyState icon={FileSpreadsheet} title="Reports aren’t part of your role" description="Ask a manager if you need a report." />
      </PageShell>
    );
  }

  /** Change a described report's dates: the same report over other days. */
  const updateCustom = (patch: Pick<ReportQuery, 'from' | 'to'>) => {
    if (!customQuery) return;
    setCustom({ q: encodeQuery({ ...customQuery, ...patch }), note: null });
  };

  const update = (patch: Partial<ReportSpec>) => {
    setSpec((s) => (s ? { ...s, ...patch } : s));
    if (presetId !== 'custom' && !presetId.startsWith('saved:')) {
      setPresetId('custom');
      setTitle('Custom');
    }
  };

  const pickPreset = (p: ReportPreset) => {
    if (custom) setCustom(null);
    setPresetId(p.id);
    setTitle(p.label);
    setSpec(specFrom(p, today));
    if (p.id === 'custom') setShowBuilder(true);
  };

  const pickSaved = (r: SavedReport) => {
    setPresetId(`saved:${r.id}`);
    setTitle(r.name);
    setSpec(specFrom(r, today));
    setCustom(r.query ? { q: encodeQuery({ ...r.query, from: addDays(today, r.range[0]), to: addDays(today, r.range[1]) } as ReportQuery) } : null);
  };

  const saveCurrent = () => {
    if (!spec) return;
    const shownTitle = custom ? (described.data?.title ?? 'Custom report') : title;
    const name = window.prompt('Name this report', presetId.startsWith('saved:') || custom ? shownTitle : `${title} report`)?.trim();
    if (!name) return;
    const { from, to, ...rest } = spec;
    const existing = saved.find((r) => r.name.toLowerCase() === name.toLowerCase());
    const q = custom ? customQuery : null;
    const range: [number, number] = q ? [dayDiff(today, q.from), dayDiff(today, q.to)] : [dayDiff(today, from), dayDiff(today, to)];
    const entry: SavedReport = {
      id: existing?.id ?? `${Date.now()}`,
      name: name.slice(0, 60),
      range,
      spec: rest,
      ...(q ? { query: (({ from: _f, to: _t, ...r }) => r)(q) } : {}),
    };
    const next = existing ? saved.map((r) => (r.id === existing.id ? entry : r)) : [...saved, entry];
    setSaved(next);
    writeSaved(next);
    setPresetId(`saved:${entry.id}`);
    setTitle(entry.name);
    toast.success(`Saved “${entry.name}”. It’s in your reports on this device.`);
  };

  const removeSaved = (r: SavedReport) => {
    const next = saved.filter((s) => s.id !== r.id);
    setSaved(next);
    writeSaved(next);
    if (presetId === `saved:${r.id}`) pickPreset(REPORT_PRESETS[0]);
  };

  const currency = (custom ? described.data?.property.currency : data?.property.currency) ?? 'USD';
  const refreshing = custom ? described.isValidating : isValidating;
  const csvHref = custom ? customCsv : csvUrl;
  const ready = custom ? !!described.data : !!data;
  const columns = columnsFor(spec?.kind ?? 'list');
  const options = data?.options;

  return (
    <PageShell
      eyebrow={property?.name ?? ' '}
      title="Reports"
      description="Ready-made front desk reports, or build your own and download it as a spreadsheet."
      actions={
        <>
          <IconButton label="Refresh" variant="outline" onClick={() => (custom ? described.mutate() : mutate())} aria-busy={refreshing || undefined}>
            <RefreshCw className={cn(refreshing && 'motion-safe:animate-spin')} />
          </IconButton>
          <Button variant="outline" onClick={saveCurrent} disabled={!spec}>
            <Bookmark aria-hidden /> Save report
          </Button>
          <Button asChild disabled={!ready}>
            <a href={csvHref ?? '#'} download aria-disabled={!ready || undefined} onClick={(e) => !ready && e.preventDefault()}>
              <Download aria-hidden /> Download CSV
            </a>
          </Button>
        </>
      }
    >
      {ctx?.agent.llmEnabled && propertyId && (
        <Card className="p-4">
          <AskReport
            propertyId={propertyId}
            onReport={(r) => {
              // The answer already holds the result: show it without running the report twice.
              void prime(`/api/admin/reports/query?${new URLSearchParams({ propertyId, q: r.q }).toString()}`, r.result, { revalidate: false });
              setPresetId('ask');
              setCustom({ q: r.q, note: r.note });
            }}
          />
        </Card>
      )}

      <section aria-label="Reports" className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {REPORT_PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={presetId === p.id ? 'soft' : 'outline'} aria-pressed={presetId === p.id} onClick={() => pickPreset(p)} title={p.description}>
              {p.id === 'custom' && <SlidersHorizontal aria-hidden />}
              {p.label}
            </Button>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Saved:</span>
            {saved.map((r) => (
              <span key={r.id} className="inline-flex items-center">
                <Button size="sm" variant={presetId === `saved:${r.id}` ? 'soft' : 'ghost'} aria-pressed={presetId === `saved:${r.id}`} onClick={() => pickSaved(r)}>
                  <Bookmark aria-hidden /> {r.name}
                </Button>
                <IconButton label={`Delete saved report ${r.name}`} size="icon-sm" onClick={() => removeSaved(r)}>
                  <Trash2 />
                </IconButton>
              </span>
            ))}
          </div>
        )}
      </section>

      {custom && customQuery && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
            <Field label="From" htmlFor="custom-from">
              <Input id="custom-from" type="date" value={customQuery.from} max={customQuery.to} onChange={(e) => e.target.value && updateCustom({ from: e.target.value, to: customQuery.to })} className="w-full sm:w-40" />
            </Field>
            <Field label="To" htmlFor="custom-to">
              <Input id="custom-to" type="date" value={customQuery.to} min={customQuery.from} onChange={(e) => e.target.value && updateCustom({ from: customQuery.from, to: e.target.value })} className="w-full sm:w-40" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Quick date ranges" role="group">
            {quickRanges(today).map((r) => (
              <Button key={r.label} size="sm" variant={customQuery.from === r.from && customQuery.to === r.to ? 'soft' : 'ghost'} onClick={() => updateCustom({ from: r.from, to: r.to })}>
                {r.label}
              </Button>
            ))}
          </div>
          {custom.note && <p className="text-sm text-muted-foreground">{custom.note}</p>}
        </Card>
      )}

      {custom && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-base font-semibold tracking-tight">{described.data?.title ?? 'Custom report'}</h2>
            {described.data && (
              <p className="text-sm text-muted-foreground tabular">
                {described.data.query.from === described.data.query.to
                  ? fmtDay(described.data.query.from, 'long')
                  : `${fmtDay(described.data.query.from, 'weekday')} – ${fmtDay(described.data.query.to, 'weekday')}`}{' '}
                · {formatNumber(described.data.rows.length)} {described.data.rows.length === 1 ? 'row' : 'rows'}
              </p>
            )}
          </div>
          {!customQuery ? (
            <div className="p-4">
              <Callout tone="danger" role="alert" title="This report link is broken">
                Describe the report again above.
              </Callout>
            </div>
          ) : described.error ? (
            <div className="p-4">
              <Callout tone="danger" role="alert" title="This report couldn’t run">
                {described.error instanceof Error ? described.error.message : 'Try again.'}
              </Callout>
            </div>
          ) : !described.data ? (
            <div className="space-y-2 p-4" role="status">
              <span className="sr-only">Running report…</span>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : described.data.rows.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="Nothing matches this report" description="Try a wider date range, or describe it differently." />
          ) : (
            <>
              {described.data.truncated && (
                <div className="px-4 pt-4">
                  <Callout tone="warning" title="Very large report">
                    Narrow the dates for exact totals.
                  </Callout>
                </div>
              )}
              <ReportTable columns={described.data.columns} rows={described.data.rows} totals={described.data.totals} currency={currency} caption={described.data.title} />
            </>
          )}
        </Card>
      )}

      {spec && !custom && (
        <Card className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-end">
              <Field label="From" htmlFor="report-from">
                <Input id="report-from" type="date" value={spec.from} max={spec.to} onChange={(e) => e.target.value && update({ from: e.target.value })} className="w-full sm:w-40" />
              </Field>
              <Field label="To" htmlFor="report-to">
                <Input id="report-to" type="date" value={spec.to} min={spec.from} onChange={(e) => e.target.value && update({ to: e.target.value })} className="w-full sm:w-40" />
              </Field>
              {spec.kind === 'list' ? (
                <Field label="Reservations" htmlFor="report-date-field">
                  <Select value={spec.dateField} onValueChange={(v) => update({ dateField: v as ReportDateField })}>
                    <SelectTrigger id="report-date-field" className="w-full sm:w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DATE_FIELD_LABEL) as ReportDateField[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {DATE_FIELD_LABEL[k]} in these dates
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <Field label="One row per" htmlFor="report-group">
                  <Select value={spec.groupBy} onValueChange={(v) => update({ groupBy: v as ReportGroupBy })}>
                    <SelectTrigger id="report-group" className="w-full sm:w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(GROUP_LABEL) as ReportGroupBy[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {GROUP_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
            <Button variant={showBuilder ? 'soft' : 'outline'} aria-expanded={showBuilder} aria-controls="report-builder" onClick={() => setShowBuilder((v) => !v)}>
              <SlidersHorizontal aria-hidden /> {showBuilder ? 'Hide filters & columns' : 'Filters & columns'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Quick date ranges" role="group">
            {quickRanges(today).map((r) => (
              <Button
                key={r.label}
                size="sm"
                variant={spec.from === r.from && spec.to === r.to ? 'soft' : 'ghost'}
                onClick={() => update({ from: r.from, to: r.to })}
              >
                {r.label}
              </Button>
            ))}
          </div>

          {showBuilder && (
            <div id="report-builder" className="space-y-4 border-t pt-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Report type</p>
                <SegmentedControl<ReportKind>
                  aria-label="Report type"
                  layoutId="report-kind"
                  size="sm"
                  value={spec.kind}
                  onChange={(kind) =>
                    update({
                      kind,
                      columns: [...columnsFor(kind)].slice(0, kind === 'list' ? 10 : 8).map((c) => c.key),
                      statuses: kind === 'summary' ? [] : spec.statuses,
                    })
                  }
                  options={[
                    { value: 'list', label: 'Reservation list' },
                    { value: 'summary', label: 'Occupancy & revenue' },
                  ]}
                />
              </div>
              <ChipFilter<BookingStatus>
                label="Status"
                options={REPORT_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS[s].label }))}
                value={spec.statuses}
                onChange={(statuses) => update({ statuses })}
              />
              <ChipFilter
                label="Room type"
                options={(options?.roomTypes ?? []).map((r) => ({ value: r.id, label: r.name }))}
                value={spec.roomTypes}
                onChange={(roomTypes) => update({ roomTypes })}
              />
              <ChipFilter
                label="Source"
                options={(options?.sources ?? []).map((s) => ({ value: s, label: sourceLabel(s) }))}
                value={spec.sources}
                onChange={(sources) => update({ sources })}
              />
              <ChipFilter
                label="Payment method"
                options={REPORT_PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
                value={spec.paymentMethods}
                onChange={(paymentMethods) => update({ paymentMethods })}
              />
              <ChipFilter
                label="Columns"
                options={columns.map((c) => ({ value: c.key, label: c.label }))}
                value={spec.columns}
                onChange={(cols) => update({ columns: columns.filter((c) => cols.includes(c.key)).map((c) => c.key) })}
              />
            </div>
          )}
        </Card>
      )}

      {!custom && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {data && spec && (
              <p className="text-sm text-muted-foreground tabular">
                {data.spec.from === data.spec.to ? fmtDay(data.spec.from, 'long') : `${fmtDay(data.spec.from, 'weekday')} – ${fmtDay(data.spec.to, 'weekday')}`} · {formatNumber(data.rows.length)}{' '}
                {data.spec.kind === 'list' ? (data.rows.length === 1 ? 'reservation' : 'reservations') : 'rows'}
              </p>
            )}
          </div>
          {error ? (
            <div className="p-4">
              <Callout tone="danger" role="alert" title="This report couldn’t run">
                {error instanceof Error ? error.message : 'Try again.'}
              </Callout>
            </div>
          ) : !data || isLoading ? (
            <div className="space-y-2 p-4" role="status">
              <span className="sr-only">Running report…</span>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : data.rows.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="Nothing matches this report" description="Try a wider date range or fewer filters." />
          ) : (
            <>
              {data.truncated && (
                <div className="px-4 pt-4">
                  <Callout tone="warning" title={`Showing the first ${formatNumber(data.rows.length)} reservations`}>
                    Narrow the dates or filters to see everything.
                  </Callout>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      {data.columns.map((c) => (
                        <th key={c.key} scope="col" className={cn('whitespace-nowrap px-4 py-2.5 font-medium', ['number', 'money', 'percent'].includes(c.format) && 'text-right')}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-accent/40">
                        {data.columns.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              'px-4 py-2.5 align-top',
                              ['number', 'money', 'percent'].includes(c.format) ? 'whitespace-nowrap text-right tabular' : c.key === 'notes' ? 'max-w-xs' : 'whitespace-nowrap',
                            )}
                          >
                            {data.spec.kind === 'summary' && data.spec.groupBy === 'date' && c.key === 'group' ? fmtDay(String(r.group), 'weekday') : formatCell(r[c.key] ?? null, c, currency)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {data.totals && (
                    <tfoot className="border-t-2 bg-surface-sunken font-medium">
                      <tr>
                        {data.columns.map((c, i) => {
                          const v = data.totals?.[c.key] ?? null;
                          return (
                            <td key={c.key} className={cn('whitespace-nowrap px-4 py-2.5', ['number', 'money', 'percent'].includes(c.format) && 'text-right tabular')}>
                              {v === null ? (i === 0 ? 'Total' : '') : formatCell(v, c, currency)}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </PageShell>
  );
}
