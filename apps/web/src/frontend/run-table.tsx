import { Activity } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, StatusDot, toneOf, type Column } from './components';
import type { Run } from '../types';
import { time } from './display';

export function Status({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`pill ${value}`}>
      {value}
    </Badge>
  );
}

const modeLabels: Record<string, string> = {
  discovery: 'Discovery',
  visual: 'Visual',
  agent: 'AI E2E',
  review: 'AI review',
};

/**
 * One line per run. A finished run reports its outcome, not both its process
 * state and its outcome: "completed · observed" said the same thing twice and
 * gave the eye two chips to sort through on every row.
 */
const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

function runStatus(run: Run) {
  if (run.state !== 'completed') return { tone: toneOf(run.state), label: sentence(run.state) };
  const outcome = run.result?.outcome;
  if (!outcome) return { tone: toneOf('completed'), label: 'Completed' };
  const changed = run.result?.captures?.some((capture) => capture.status === 'changed');
  return changed
    ? { tone: 'warning' as const, label: 'Changed' }
    : { tone: toneOf(outcome), label: sentence(outcome) };
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
    { key: 'mode', header: 'Type', cell: (run) => modeLabels[run.mode] ?? run.mode },
    {
      key: 'status',
      header: 'Status',
      cell: (run) => {
        const status = runStatus(run);
        return <StatusDot tone={status.tone}>{status.label}</StatusDot>;
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
          <Button variant="ghost" size="sm" data-open-run={run.id}>
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
