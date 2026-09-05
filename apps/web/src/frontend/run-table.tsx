import { Activity, ArrowUpRight } from 'lucide-react';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import type { Run } from '../types';
import { time } from './display';
export function Status({ value }: { value: string }) {
  return (
    <Badge variant="outline" className={`pill ${value}`}>
      {value}
    </Badge>
  );
}
export function RunTable({ runs }: { runs: Run[] }) {
  if (!runs.length)
    return (
      <div className="empty">
        <Activity size={24} />
        <h2>No runs yet</h2>
        <p className="muted">
          Start with source discovery. Add a test origin for visual comparison or an Arxic
          configuration for AI E2E.
        </p>
      </div>
    );
  return (
    <div className="panel run-list">
      <table className="table">
        <thead>
          <tr>
            <th>PROJECT / RUN</th>
            <th>TYPE</th>
            <th>STATUS</th>
            <th>STARTED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td data-label="PROJECT / RUN">
                {run.project.name}
                <small>{run.id.slice(0, 8)}</small>
              </td>
              <td data-label="TYPE">{run.mode}</td>
              <td data-label="STATUS">
                <Status value={run.state} /> {run.result && <Status value={run.result.outcome} />}
              </td>
              <td data-label="STARTED">{time(run.createdAt)}</td>
              <td data-label="ACTIONS">
                <Button variant="ghost" size="sm" className="text-button" data-open-run={run.id}>
                  View result <ArrowUpRight />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
