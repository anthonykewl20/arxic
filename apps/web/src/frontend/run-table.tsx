import { Activity } from 'lucide-react';
import { actions } from './dashboard-actions';
import { Badge, Button, DataTable, EmptyState, StatusDot, toneOf, type Column } from './components';
import type { Run } from '../types';
import { time } from './display';
import { evidenceWords, runModeWords } from '../plain-words';

/**
 * A raw engine state as a pill.
 *
 * The pill stylesheet used to title-case everything, which was fine while
 * pills only ever held engine words and wrong as soon as they held sentences
 * ("2 to review" became "2 To Review"). The capitalisation belongs to the one
 * caller that shows an engine word, not to every pill on the screen.
 */
export function Status({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`pill ${value}`}>
      {value.charAt(0).toUpperCase() + value.slice(1)}
    </Badge>
  );
}

/**
 * A run is named the same everywhere.
 *
 * The button on a project says "Screenshot test"; the run it produced must not
 * be called "Visual" in the history. One vocabulary, from the control that
 * starts the work to the record of it.
 */

/**
 * One line per run. A finished run reports its outcome, not both its process
 * state and its outcome: "completed · observed" said the same thing twice and
 * gave the eye two chips to sort through on every row.
 */
/** Process states, said as what is happening rather than as a state name. */
const processStates: Record<string, string> = {
  queued: 'Waiting to start',
  running: 'Running now',
  blocked: 'Could not run',
  cancelled: 'Stopped',
};

function runStatus(run: Run) {
  if (run.state !== 'completed')
    return {
      tone: toneOf(run.state),
      label: processStates[run.state] ?? run.state,
      detail: '',
    };
  const outcome = run.result?.outcome;
  if (!outcome) return { tone: toneOf('completed'), label: 'Finished', detail: '' };
  const changed = run.result?.captures?.some((capture) => capture.status === 'changed');
  if (changed)
    return {
      tone: 'warning' as const,
      label: 'Needs your decision',
      detail: 'Screenshots differ from the pictures you approved.',
    };
  const words = evidenceWords(outcome);
  return { tone: toneOf(outcome), label: words.label, detail: words.detail };
}

export function RunTable({ runs }: { runs: Run[] }) {
  const columns: ReadonlyArray<Column<Run>> = [
    {
      key: 'project',
      header: 'Project',
      width: '32%',
      cell: (run) => (
        <span className="flex flex-col">
          <span className="font-medium text-[var(--foreground)]">{run.project.name}</span>
          <span className="font-mono text-[11px] tabular-nums text-[var(--foreground-muted)]">
            {run.id.slice(0, 8)}
          </span>
        </span>
      ),
    },
    {
      key: 'mode',
      header: 'Type',
      cell: (run) => (
        <span title={runModeWords(run.mode).detail}>{runModeWords(run.mode).label}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (run) => {
        const status = runStatus(run);
        return (
          <StatusDot tone={status.tone} title={status.detail || undefined}>
            {status.label}
          </StatusDot>
        );
      },
    },
    {
      key: 'started',
      header: 'Started',
      cell: (run) => <span className="tabular-nums">{time(run.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      bare: true,
      cell: (run) => (
        <span className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            data-open-run={run.id}
            onClick={() => actions().openRun(run.id)}
          >
            View result
          </Button>
        </span>
      ),
    },
  ];
  return (
    <DataTable
      className="run-list"
      caption="Test runs"
      columns={columns}
      rows={runs}
      rowKey={(run) => run.id}
      empty={
        <EmptyState icon={Activity} title="No runs yet">
          Start with source discovery. Add a test origin for visual comparison, or an Arxic
          configuration for AI E2E.
        </EmptyState>
      }
    />
  );
}
