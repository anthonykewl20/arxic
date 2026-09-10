import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Camera,
  Code2,
  ExternalLink,
  FileSearch,
  Layers,
  LayoutGrid,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { actions } from './dashboard-actions';
import { ago, time } from './display';
import { DiffViewer } from './diff-viewer';
import { ActionTimeline } from './action-timeline';
import {
  Button,
  Badge,
  EmptyState,
  FilterSelect,
  Note,
  Pagination,
  SearchField,
  Section,
  StatusDot,
  Thumbnail,
  Toolbar,
  type Tone,
} from './components';
import { elementKindLabels } from '../element-kinds';
import { describeScene, parseElementScene } from '../element-scene';
import {
  browserName,
  captureWords,
  environmentWords,
  sizeName,
  stateName,
  themeName,
  type Words,
} from '../plain-words';
import type { PageEntry, PageStatus } from '../page-inventory';
import { routeStateCoverage } from '../route-coverage';
import type { Capture, Project, Run } from '../types';

export const PAGE_GRID_SIZE = 12;

const artifact = (runId: string, file: string) =>
  `/api/runs/${runId}/artifacts/${encodeURIComponent(file)}`;

/** One sentence per state, so a card never has to be decoded. */
const statusWords: Record<PageStatus, { label: string; tone: Tone }> = {
  'needs-review': { label: 'Needs your decision', tone: 'warning' },
  problem: { label: 'Something is wrong', tone: 'danger' },
  untested: { label: 'Not tested yet', tone: 'neutral' },
  'first-look': { label: 'First look — nothing to compare against', tone: 'info' },
  ok: { label: 'Looks right', tone: 'success' },
};

const filters = [
  { value: '', label: 'All pages' },
  { value: 'needs-review', label: 'Needs a decision' },
  { value: 'problem', label: 'Something wrong' },
  { value: 'untested', label: 'Not tested yet' },
  { value: 'ok', label: 'Looking right' },
] as const;

function matches(page: PageEntry, search: string, filter: string) {
  const needle = search.trim().toLowerCase();
  return (
    (!filter || page.status === filter) &&
    (!needle ||
      page.path.toLowerCase().includes(needle) ||
      page.title.toLowerCase().includes(needle))
  );
}

/** "Chrome, Firefox and Safari · Desktop and Phone" — how a person says coverage. */
function list(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function coverageLine(page: PageEntry) {
  if (!page.captures.length) return 'No screenshots yet';
  const parts = [
    list(page.browsers.map(browserName)),
    list([...new Set(page.sizes.map((size) => sizeName(size.width)))]),
  ].filter(Boolean);
  if (page.themes.length > 1) parts.push('light and dark');
  return parts.join(' · ');
}

function checkSummary(page: PageEntry) {
  const problems = page.failing.filter((check) => check.tone === 'problem');
  if (!page.captures.length) return 'Nothing has been checked here yet.';
  if (!problems.length)
    return `${page.passing.length} ${page.passing.length === 1 ? 'check' : 'checks'} passed.`;
  return problems.length === 1
    ? problems[0]!.label
    : `${problems.length} problems, including ${problems[0]!.label.toLowerCase()}`;
}

function PageCard({ page }: { page: PageEntry }) {
  const status = statusWords[page.status];
  return (
    <article className="page-card flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <button
        type="button"
        data-open-page={page.path}
        className="group flex flex-col gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        onClick={() => actions().openPage(page.projectId, page.path)}
      >
        <Thumbnail
          src={page.thumbnail ? artifact(page.thumbnail.runId, page.thumbnail.capture.file) : ''}
          alt={`Screenshot of ${page.title}`}
          empty="Not photographed yet"
          overlay={
            page.needsReview ? (
              <Badge className="pill changed">{page.needsReview} to review</Badge>
            ) : null
          }
        />
        <span className="flex min-w-0 flex-col">
          <h3 className="text-[14px] font-medium text-[var(--foreground)] group-hover:underline">
            {page.title}
          </h3>
          {/* Two projects can both have a Home page; the card says whose. */}
          <span className="folder truncate text-[11px]" title={`${page.projectName} ${page.path}`}>
            {page.projectName} · {page.path}
          </span>
        </span>
      </button>
      <div className="flex flex-col gap-1 text-[12px]">
        <StatusDot tone={status.tone}>{status.label}</StatusDot>
        <p className="text-[var(--foreground-muted)]">{checkSummary(page)}</p>
        <p
          className="text-[11px] text-[var(--foreground-muted)]"
          title={time(page.checkedAt ?? null)}
        >
          {coverageLine(page)}
          {page.checkedAt ? ` · checked ${ago(page.checkedAt)}` : ''}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          data-run-page={page.path}
          onClick={() => actions().runPageTest(page.projectId, page.path)}
        >
          <Camera /> Run test
        </Button>
        {page.signedIn && (
          <span
            className="flex items-center gap-1 text-[11px] text-[var(--foreground-muted)]"
            title="Arxic signed in before taking this screenshot"
          >
            <ShieldCheck size={12} aria-hidden="true" /> Signed in
          </span>
        )}
      </div>
    </article>
  );
}

/** A check, and — only where it earns the space — what it means. */
function CheckLine({ check, passing }: { check: Words; passing?: boolean }) {
  return (
    <li className="flex gap-2">
      <StatusDot
        tone={passing ? 'success' : check.tone === 'problem' ? 'danger' : 'warning'}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] text-[var(--foreground)]">{check.label}</span>
        {!passing && check.detail && (
          <span className="max-w-[var(--measure)] text-[12px] text-[var(--foreground-muted)]">
            {check.detail}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * What the page is made of.
 *
 * Counted from the last screenshot's measured layout. There are no names here
 * on purpose: the measurement pipeline never retains the target application's
 * text, labels, URLs or values, so Arxic can say "two form fields" and must
 * not pretend to know they are called Email and Password.
 */
function WhatsOnThisPage({ shot }: { shot: { runId: string; capture: Capture } }) {
  const [census, setCensus] = useState<Array<{ kind: number; count: number }>>();
  const [error, setError] = useState('');
  const { runId, capture } = shot;
  useEffect(() => {
    let live = true;
    setCensus(undefined);
    setError('');
    if (!capture.assessmentFile) {
      setError('This screenshot has no layout measurements.');
      return;
    }
    void fetch(artifact(runId, capture.assessmentFile), { credentials: 'same-origin' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('unavailable')),
      )
      .then((value) => {
        if (!live) return;
        const scene = parseElementScene(value, capture);
        if (!scene) throw new Error('unsupported');
        setCensus(describeScene(scene));
      })
      .catch(() => live && setError('Layout measurements are unavailable for this screenshot.'));
    return () => {
      live = false;
    };
  }, [runId, capture]);
  if (error) return <p className="muted text-[13px]">{error}</p>;
  if (!census) return <p className="muted text-[13px]">Counting what is on the page…</p>;
  if (!census.length) return <p className="muted text-[13px]">Nothing measurable was on screen.</p>;
  return (
    <>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
        {census.map(({ kind, count }) => (
          // The space is real text, not flex gap: a screen reader reads the
          // list item's own words, and "2form fields" is what a gap leaves it.
          <li key={kind} className="flex items-baseline gap-1.5">
            <strong className="tabular-nums text-[15px] font-semibold">{count}</strong>{' '}
            <span className="text-[var(--foreground-muted)]">
              {(elementKindLabels[kind] ?? 'Other').toLowerCase()}
              {count === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted text-[12px]">
        Counted from the last screenshot. Arxic never stores your page&rsquo;s words, links or
        values, so it can count the fields on a form but not read them.
      </p>
    </>
  );
}

/** Every screenshot of this page, in the order the page moves through them. */
function Filmstrip({ page }: { page: PageEntry }) {
  // One frame per state and screen size. Grouping by state alone collapsed the
  // phone capture into a "2 screenshots" footnote, which is the coverage a
  // person most wants to see.
  const groups = new Map<string, PageEntry['shots']>();
  for (const shot of page.shots) {
    const key = `${shot.state}|${sizeName(shot.capture.viewport.width)}`;
    groups.set(key, [...(groups.get(key) ?? []), shot]);
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[...groups].map(([key, shots]) => {
        const [state = ''] = key.split('|');
        const shot = shots[0]!;
        const environment = shot.capture.environment;
        const words = captureWords(shot.capture.status, shot.capture.changedPixels);
        return (
          <figure key={key} className="flex flex-col gap-1.5">
            <a href={artifact(shot.runId, shot.capture.file)} target="_blank" rel="noopener">
              <Thumbnail
                src={artifact(shot.runId, shot.capture.file)}
                alt={`${page.title}, ${stateName(state || undefined).toLowerCase()}`}
                ratio="4 / 3"
              />
            </a>
            <figcaption className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">
                {stateName(state || undefined)} · {sizeName(shot.capture.viewport.width)}
              </span>
              <StatusDot
                tone={
                  words.tone === 'ok'
                    ? 'success'
                    : words.tone === 'attention'
                      ? 'warning'
                      : words.tone === 'problem'
                        ? 'danger'
                        : 'neutral'
                }
                className="text-[12px]"
              >
                {words.label}
              </StatusDot>
              <small className="text-[11px] text-[var(--foreground-muted)]">
                {environment ? browserName(environment.browser) : 'Chrome'} ·{' '}
                {environment ? themeName(environment.colorScheme) : 'Light'} ·{' '}
                {shot.capture.viewport.width}×{shot.capture.viewport.height}
                {shots.length > 1 ? ` · ${shots.length} screenshots` : ''}
              </small>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/**
 * The source files behind this page.
 *
 * Fetched from the newest discovery run rather than kept in the polled state:
 * the source inventory is megabytes and only matters once a person has opened
 * one page and asked where it comes from.
 */
function WhereItComesFrom({ page, runs }: { page: PageEntry; runs: Run[] }) {
  const discovery = runs.find(
    (run) =>
      run.projectId === page.projectId && run.mode === 'discovery' && run.state === 'completed',
  );
  const [files, setFiles] = useState<{ commit: string; paths: string[] }>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setFiles(undefined);
    setError('');
    if (!discovery) {
      setError('Run "Read the code" on this project to link its pages back to source files.');
      return;
    }
    void fetch(`/api/runs/${discovery.id}`, { credentials: 'same-origin' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('unavailable')),
      )
      .then((detail: Run) => {
        if (!live) return;
        const inventory = detail.result?.inventory as Parameters<typeof routeStateCoverage>[0];
        const frontend = detail.result?.frontend;
        if (!inventory?.rows || !frontend) throw new Error('unsupported');
        const paths = [
          ...new Set(
            routeStateCoverage(inventory, frontend)
              .filter((route) => route.path === page.path)
              .flatMap((route) => route.files),
          ),
        ].sort();
        setFiles({ commit: frontend.revision.commit ?? '', paths });
      })
      .catch(() => live && setError('The source inventory for this project could not be read.'));
    return () => {
      live = false;
    };
  }, [discovery, page.path]);
  if (error) return <p className="muted text-[13px]">{error}</p>;
  if (!files) return <p className="muted text-[13px]">Looking this page up in your code…</p>;
  if (!files.paths.length)
    return (
      <p className="muted text-[13px]">
        No source file could be matched to this page. It may be served by a framework route Arxic
        does not read yet, or reached only at runtime.
      </p>
    );
  return (
    <>
      <ul className="flex flex-col gap-1">
        {files.paths.map((file) => (
          <li key={file} className="folder truncate text-[12px]" title={file}>
            {file}
          </li>
        ))}
      </ul>
      {files.commit && (
        <p className="muted text-[12px]">
          Read at commit <code>{files.commit.slice(0, 12)}</code>. Compare that commit in your
          repository to see what changed since this page was last photographed.
        </p>
      )}
    </>
  );
}

function PageDetail({ page, runs }: { page: PageEntry; runs: Run[] }) {
  const terms = useId();
  const [showTerms, setShowTerms] = useState(false);
  const changed = page.pending;
  const history = runs
    .filter((run) => run.result?.captures?.some((capture) => capture.path === page.path))
    .slice(0, 8);
  return (
    <>
      <Toolbar>
        <Button variant="ghost" size="sm" data-close-page onClick={() => actions().closePage()}>
          <ArrowLeft /> All pages
        </Button>
        <span className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`pill env-${environmentWords(page.environment).term}`}
            title={environmentWords(page.environment).detail}
          >
            {environmentWords(page.environment).label}
          </Badge>
          <span className="folder text-[12px]">
            {page.projectName} · {page.path}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          {page.url && (
            <Button variant="outline" size="sm" asChild>
              <a href={page.url} target="_blank" rel="noopener">
                <ExternalLink /> Open the real page
              </a>
            </Button>
          )}
          <Button
            size="sm"
            data-run-page={page.path}
            onClick={() => actions().runPageTest(page.projectId, page.path)}
          >
            <Camera /> Run test
          </Button>
        </span>
      </Toolbar>

      <Section
        title="How it looks"
        description={
          page.shots.length
            ? 'Every screenshot Arxic took of this page: one frame per state it was put into, at each screen size.'
            : undefined
        }
        meta={page.checkedAt ? `checked ${ago(page.checkedAt)}` : undefined}
      >
        {page.shots.length ? (
          <Filmstrip page={page} />
        ) : (
          <EmptyState
            icon={Camera}
            title="No screenshots of this page yet"
            action={
              <Button onClick={() => actions().runPageTest(page.projectId, page.path)}>
                <Camera /> Run test
              </Button>
            }
          >
            Arxic knows this page exists but has never opened it. Run a test to photograph it in
            every browser, theme and screen size the project covers.
          </EmptyState>
        )}
      </Section>

      {page.thumbnail && page.runId && (
        <Section title="What&rsquo;s on this page">
          <WhatsOnThisPage shot={page.thumbnail} />
          {/* A recording would say this better; video cannot carry the privacy
              masks a screenshot gets, so the steps are shown instead. */}
          <ActionTimeline
            runId={page.runId}
            captures={page.captures}
            label="What Arxic did to reach and photograph this page"
          />
        </Section>
      )}

      <Section
        title="Checks"
        description="What Arxic looked for on this page the last time it ran."
        actions={
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showTerms}
            aria-controls={terms}
            onClick={() => setShowTerms(!showTerms)}
          >
            {showTerms ? 'Hide technical names' : 'Show technical names'}
          </Button>
        }
      >
        {page.failing.length || page.passing.length ? (
          <>
            <ul className="flex flex-col gap-2.5">
              {page.failing.map((check) => (
                <CheckLine key={check.term} check={check} />
              ))}
              {page.passing.map((check) => (
                <CheckLine key={check.term} check={check} passing />
              ))}
            </ul>
            {page.unsettled > 0 && (
              <Note>
                {page.unsettled} {page.unsettled === 1 ? 'screenshot' : 'screenshots'} of this page
                would not settle, so nothing was measured from{' '}
                {page.unsettled === 1 ? 'it' : 'them'}. Animation or content that arrives late is
                the usual cause.
              </Note>
            )}
            <div id={terms} hidden={!showTerms}>
              <ul className="flex flex-col gap-1 text-[12px]">
                {[...page.failing, ...page.passing].map((check) => (
                  <li key={check.term} className="flex flex-wrap gap-x-2">
                    <code>{check.term}</code>
                    <span className="text-[var(--foreground-muted)]">{check.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="muted text-[13px]">
            Nothing has been checked here yet. Run a test and the results appear in this list.
          </p>
        )}
      </Section>

      {changed.length > 0 && page.runId && (
        <Section
          title="Waiting for your decision"
          description="These screenshots differ from the picture you approved. Approve the new one if the change was intended."
          meta={`${changed.length} of ${page.captures.length}`}
        >
          {changed.map((capture) => (
            <ChangeReview key={capture.id} capture={capture} runId={page.runId!} />
          ))}
        </Section>
      )}

      <Section title="Where it comes from" description="The source files this page is built from.">
        <WhereItComesFrom page={page} runs={runs} />
      </Section>

      <Section title="History" meta={`${history.length} recent`}>
        {history.length ? (
          <ul className="flex flex-col gap-1.5">
            {history.map((run) => {
              const shots = run.result?.captures?.filter(
                (capture) => capture.path === page.path,
              ).length;
              return (
                <li key={run.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-button"
                    onClick={() => actions().openRun(run.id)}
                  >
                    {ago(run.finishedAt ?? run.createdAt)}
                  </Button>
                  <span className="text-[var(--foreground-muted)]">
                    {shots} {shots === 1 ? 'screenshot' : 'screenshots'}
                  </span>
                  <span className="folder text-[11px]" title={time(run.createdAt)}>
                    {run.id.slice(0, 8)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted text-[13px]">This page has not been photographed yet.</p>
        )}
      </Section>
    </>
  );
}

/**
 * One pending decision.
 *
 * The queue used to stack a full comparison viewer per change: eight changes
 * made a twenty-thousand-pixel page nobody could scan. What a reviewer needs
 * first is small — which screen, how big the difference, what moved, and the
 * before and after side by side. The full viewer, with swipe and overlay and
 * the changed-region walk, is one disclosure below that.
 */
export function ChangeReview({
  capture,
  runId,
  heading,
}: {
  capture: Capture;
  runId: string;
  heading?: ReactNode;
}) {
  const words = captureWords(capture.status, capture.changedPixels);
  const environment = capture.environment;
  // "Other" and "Region" are what the measurement calls a div. Naming them
  // tells a reviewer nothing and makes the sentence sound like an evasion, so
  // only the kinds a person recognises are listed; if none moved, the line goes.
  const anonymous = new Set(['Other', 'Region']);
  const moved = [
    ...new Set(
      (capture.diffExplanation?.regions ?? [])
        .flatMap((region) => region.elements.map((element) => element.label))
        .filter((label) => label && !anonymous.has(label)),
    ),
  ];
  const before =
    capture.baselineFile && capture.baselineRunId
      ? artifact(capture.baselineRunId, capture.baselineFile)
      : '';
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3"
      data-change={capture.id}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-col">
          {heading}
          <small className="text-[12px] text-[var(--foreground-muted)]">
            {environment ? browserName(environment.browser) : 'Chrome'} ·{' '}
            {environment ? themeName(environment.colorScheme) : 'Light'} ·{' '}
            {sizeName(capture.viewport.width)} {capture.viewport.width}×{capture.viewport.height}
            {capture.stateVariant ? ` · ${stateName(capture.stateVariant).toLowerCase()}` : ''}
          </small>
        </span>
        <Button
          size="sm"
          data-approve={capture.id}
          onClick={() => actions().approveBaseline(runId, capture.id)}
        >
          Approve this picture
        </Button>
      </div>
      <p className="text-[13px] text-[var(--foreground-muted)]">{words.detail}</p>
      {moved.length ? (
        <p className="text-[13px]">
          What changed: {list(moved.map((label) => label.toLowerCase()))}.
        </p>
      ) : null}
      {/*
        Whole screenshots, not crops. A reviewer is deciding whether the page
        is right; a phone capture cropped to its navigation bar answers nothing.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="flex flex-col gap-1">
          <figcaption className="text-[12px] text-[var(--foreground-muted)]">
            What you approved
          </figcaption>
          <Thumbnail
            src={before}
            fit="contain"
            ratio="4 / 3"
            alt="The approved picture"
            empty="No approved picture"
          />
        </figure>
        <figure className="flex flex-col gap-1">
          <figcaption className="text-[12px] text-[var(--foreground-muted)]">Now</figcaption>
          <Thumbnail
            src={artifact(runId, capture.file)}
            fit="contain"
            ratio="4 / 3"
            alt="This run's screenshot"
          />
        </figure>
      </div>
      <details>
        <summary>Compare them closely</summary>
        <DiffViewer capture={capture} runId={runId} />
      </details>
      <p className="muted text-[12px]">
        Approving replaces the picture later runs are measured against. If this change is a bug,
        leave it here and fix the page — the comparison stays until someone decides.
      </p>
    </article>
  );
}

export type PagesPanelProps = {
  pages: PageEntry[];
  projects: Project[];
  runs: Run[];
  projectId: string;
  search: string;
  filter: string;
  offset: number;
  /** Empty shows the grid; a path shows that page in full. */
  selected: string;
  onFilter: (kind: 'project' | 'status', value: string) => void;
  onSearch: (value: string) => void;
  onPage: (direction: -1 | 1) => void;
};

export function PagesPanel(props: PagesPanelProps) {
  const { pages, projects, projectId, search, filter, offset, selected, runs } = props;
  const open = selected
    ? pages.find((page) => page.path === selected && (!projectId || page.projectId === projectId))
    : undefined;
  if (selected && open) return <PageDetail page={open} runs={runs} />;
  const visible = pages.filter((page) => matches(page, search, filter));
  const start = Math.min(
    offset,
    Math.max(0, (Math.ceil(visible.length / PAGE_GRID_SIZE) - 1) * PAGE_GRID_SIZE),
  );
  const shown = visible.slice(start, start + PAGE_GRID_SIZE);
  const untested = pages.filter((page) => page.status === 'untested').length;
  return (
    <>
      <Toolbar>
        {projects.length > 1 && (
          <FilterSelect
            id="project-filter"
            label="Filter by project"
            value={projectId}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={(value) => props.onFilter('project', value)}
          />
        )}
        <FilterSelect
          id="page-status"
          label="Filter pages"
          value={filter}
          options={filters}
          onChange={(value) => props.onFilter('status', value)}
        />
        <SearchField
          id="page-search"
          label="Search pages"
          placeholder="Page name or address"
          defaultValue={search}
          onSearch={props.onSearch}
        />
      </Toolbar>
      {selected && !open && (
        <Note>
          That page is no longer in this project&rsquo;s inventory. It may have been removed from
          the site, or the project filter may be hiding it.
        </Note>
      )}
      {/* No "Pages" heading here: the screen is already titled Pages, and a
          second one under it is a label, not information. */}
      <Section
        meta={
          visible.length === pages.length
            ? `${pages.length} found`
            : `${visible.length} of ${pages.length}`
        }
      >
        {shown.length ? (
          <div className="page-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((page) => (
              <PageCard key={page.key} page={page} />
            ))}
          </div>
        ) : pages.length ? (
          <EmptyState icon={FileSearch} title="No pages match">
            Nothing here matches that search or filter. Clear them to see all {pages.length} pages.
          </EmptyState>
        ) : projects.length ? (
          <EmptyState
            icon={LayoutGrid}
            title="No pages found yet"
            action={
              <Button onClick={() => actions().navigate('overview')}>
                <Play /> Go to projects
              </Button>
            }
          >
            {projects.length === 1
              ? `${projects[0]!.name} has not been read or photographed yet.`
              : 'None of your projects has been read or photographed yet.'}{' '}
            Run <strong>Read the code</strong> to list the pages, then{' '}
            <strong>Screenshot test</strong> to open each one in a real browser.
          </EmptyState>
        ) : (
          <EmptyState
            icon={LayoutGrid}
            title="No pages yet"
            action={
              <Button onClick={() => actions().addProject()}>
                <Play /> Connect a project
              </Button>
            }
          >
            Connect a project and Arxic reads its code to find the pages, then opens each one in a
            real browser to photograph and check it.
          </EmptyState>
        )}
        {visible.length > PAGE_GRID_SIZE && (
          <Pagination
            offset={start}
            count={shown.length}
            total={visible.length}
            unit="pages"
            onPage={props.onPage}
          />
        )}
      </Section>
      {untested > 0 && pages.length > untested && (
        <Note>
          {untested} of these {pages.length} pages have never been photographed. Run a screenshot
          test on the project to cover them all at once.
        </Note>
      )}
    </>
  );
}

/** The review queue: every pending decision across every page, in one place. */
export function ChangesPanel({
  pages,
  projects,
  projectId,
  onFilter,
}: {
  pages: PageEntry[];
  projects: Project[];
  projectId: string;
  onFilter: (kind: 'project', value: string) => void;
}) {
  const waiting = pages.filter((page) => page.needsReview > 0);
  const total = waiting.reduce((sum, page) => sum + page.needsReview, 0);
  return (
    <>
      {projects.length > 1 && (
        <Toolbar>
          <FilterSelect
            id="project-filter"
            label="Filter by project"
            value={projectId}
            options={[
              { value: '', label: 'All projects' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
            onChange={(value) => onFilter('project', value)}
          />
        </Toolbar>
      )}
      {waiting.length ? (
        <>
          <Note>
            {total} {total === 1 ? 'screenshot differs' : 'screenshots differ'} from the picture you
            approved, across {waiting.length} {waiting.length === 1 ? 'page' : 'pages'}. Approve the
            ones that changed on purpose; leave the ones that look like bugs.
          </Note>
          {waiting.map((page) => (
            <Section
              key={page.key}
              title={page.title}
              meta={`${page.needsReview} ${page.needsReview === 1 ? 'change' : 'changes'}`}
              description={`${page.projectName} · ${page.path}`}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => actions().openPage(page.projectId, page.path)}
                >
                  <Layers /> Open page
                </Button>
              }
            >
              {page.pending.map((capture) => (
                <ChangeReview key={capture.id} capture={capture} runId={page.runId!} />
              ))}
            </Section>
          ))}
        </>
      ) : (
        <EmptyState icon={Code2} title="Nothing to review">
          Every screenshot matches the picture you approved. When a page changes, it lands here for
          a decision.
        </EmptyState>
      )}
    </>
  );
}
