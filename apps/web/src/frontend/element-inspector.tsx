import { useId, useRef, useState } from 'react';
import type { Capture } from '../types';
import { elementsAtPoint, type ElementScene } from '../element-scene';
import type { VisualCheck } from '../visual-oracle';
import { Button, Input, Label, Select } from './components';
import { elementKindLabels } from '../element-kinds';
import { Status } from './run-table';
const pageSize = 10;

export function ElementInspector({
  scene,
  capture,
  runId,
  checks,
}: {
  scene?: ElementScene;
  capture: Pick<Capture, 'file'>;
  runId: string;
  checks: VisualCheck[];
}) {
  const [open, setOpen] = useState(false);
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const kindId = useId();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number>();
  const preview = useRef<SVGSVGElement>(null);
  const panelId = useId(),
    hint = useId(),
    searchId = useId();
  if (!scene)
    return (
      <p className="scope-note">
        Element geometry is unavailable, unstable, or outside the supported bounds. Run a fresh
        visual capture to inspect elements.
      </p>
    );
  const selected =
    imageState === 'ready' ? scene.nodes.find((n) => n.id === selectedId) : undefined;
  function matchesKind(node: ElementScene['nodes'][number]) {
    return (
      kind === 'all' || (kind === 'unknown' ? node.kind === undefined : node.kind === Number(kind))
    );
  }
  const candidates = (point ? elementsAtPoint(scene, point.x, point.y) : scene.nodes).filter(
    (n) => matchesKind(n) && String(n.id).includes(query.trim()),
  );
  const visible = candidates.slice(page * pageSize, (page + 1) * pageSize);
  const parent = selected ? scene.nodes.find((n) => n.id === selected.parent) : undefined;
  const related = selected
    ? checks.filter(
        (check) =>
          check.region &&
          check.region.x < selected.x + selected.width &&
          check.region.x + check.region.width > selected.x &&
          check.region.y < selected.y + selected.height &&
          check.region.y + check.region.height > selected.y,
      )
    : [];
  const url = `/api/runs/${runId}/artifacts/${encodeURIComponent(capture.file)}`;
  function clear() {
    setQuery('');
    setKind('all');
    setPoint(null);
    setPage(0);
    setSelectedId(undefined);
  }
  function chooseParent() {
    if (!parent || !scene) return;
    setQuery('');
    setKind('all');
    setPoint(null);
    setPage(Math.floor(scene.nodes.indexOf(parent) / pageSize));
    setSelectedId(parent.id);
  }
  return (
    <div className="element-inspection">
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        Inspect captured elements
      </Button>
      {open && (
        <section id={panelId} className="element-inspector" aria-label="Captured elements">
          <h3>Captured elements</h3>
          <p id={hint}>
            Filter by element type, choose a point in the screenshot, or find an element number
            below. Overlapping boxes are listed smallest first; this does not establish which
            element is painted on top.
          </p>
          <p className="scope-note">
            {scene.nodes.length} captured boxes · Current viewport only. Element numbers identify
            numeric measurements, not replay locators. Types are browsing hints, not verified
            accessibility roles. Text and field values are not retained.
          </p>
          {scene.kindSchemaVersion !== 1 && (
            <p className="scope-note">
              Older capture: element types were not recorded. Screenshot picking and element-number
              search are still available.
            </p>
          )}
          {scene.truncated && (
            <p role="status">
              Capture limit reached. Some elements were not measured; this is incomplete coverage.
            </p>
          )}
          {imageState === 'loading' && <p role="status">Loading image for element inspection…</p>}
          {imageState === 'error' && (
            <div>
              <p role="alert">
                Image evidence is unavailable or does not match this viewport. Element picking is
                disabled.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setImageState('loading');
                  setSelectedId(undefined);
                  setAttempt(attempt + 1);
                }}
              >
                Retry element image
              </Button>
            </div>
          )}
          <div className="element-image-frame">
            <img
              key={attempt}
              className="element-image"
              hidden={imageState === 'error'}
              src={`${url}?attempt=${attempt}`}
              alt="Captured viewport for element inspection"
              onLoad={(event) => {
                const image = event.currentTarget;
                if (
                  Math.abs(
                    image.naturalWidth / image.naturalHeight -
                      scene.viewport.width / scene.viewport.height,
                  ) > 0.001
                ) {
                  setImageState('error');
                  setSelectedId(undefined);
                } else setImageState('ready');
              }}
              onError={() => {
                setImageState('error');
                setSelectedId(undefined);
              }}
            />
            {imageState === 'ready' && (
              <svg
                ref={preview}
                className="element-picker"
                viewBox={`0 0 ${scene.viewport.width} ${scene.viewport.height}`}
                role="img"
                aria-label="Pick an element in captured screenshot"
                aria-describedby={hint}
                tabIndex={-1}
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  const x = ((event.clientX - box.left) * scene.viewport.width) / box.width,
                    y = ((event.clientY - box.top) * scene.viewport.height) / box.height;
                  const matches = elementsAtPoint(scene, x, y).filter(matchesKind);
                  setPoint({ x, y });
                  setQuery('');
                  setPage(0);
                  setSelectedId(matches[0]?.id);
                }}
              >
                {selected && (
                  <g>
                    <rect
                      x={selected.x}
                      y={selected.y}
                      width={selected.width}
                      height={selected.height}
                      fill="none"
                      stroke="white"
                      strokeWidth={5}
                    />
                    <rect
                      x={selected.x}
                      y={selected.y}
                      width={selected.width}
                      height={selected.height}
                      fill="none"
                      stroke="#b00020"
                      strokeWidth={2}
                    />
                  </g>
                )}
              </svg>
            )}
          </div>
          {selected && (
            <section className="element-details" aria-label="Selected element measurements">
              <h4>Element {selected.id}</h4>
              <p>
                Type: {selected.kind === undefined ? 'Unknown' : elementKindLabels[selected.kind]}
              </p>
              <p>
                CSS bounds (rounded for display): x {selected.x.toFixed(2)}, y{' '}
                {selected.y.toFixed(2)}, width {selected.width.toFixed(2)}, height{' '}
                {selected.height.toFixed(2)}.
              </p>
              <div className="toolbar">
                <Button
                  variant="outline"
                  onClick={() => {
                    preview.current?.focus();
                    preview.current?.scrollIntoView({ block: 'center' });
                  }}
                >
                  Show selected on screenshot
                </Button>
                {parent ? (
                  <Button variant="outline" onClick={chooseParent}>
                    Inspect parent element {parent.id}
                  </Button>
                ) : (
                  <p>
                    {selected.parent === null
                      ? 'No parent element.'
                      : 'Parent was not retained in this viewport.'}
                  </p>
                )}
              </div>
              <details className="element-checks" key={selected.id}>
                <summary>Checks overlapping this area ({related.length})</summary>
                {!related.length ? (
                  <p>No checks reference this area. Selecting an element does not make it pass.</p>
                ) : (
                  <ul>
                    {related.map((check) => (
                      <li key={check.id}>
                        <strong>{check.id}</strong> <Status value={check.verdict} />
                        <p>{check.reason}</p>
                        <small>Measurement references: {check.measurementIds.join(', ')}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </section>
          )}
          {imageState === 'ready' && (
            <>
              <p role="status">
                {point
                  ? `${candidates.length} ${candidates.length === 1 ? 'element' : 'elements'} at this point`
                  : `${candidates.length} matching ${candidates.length === 1 ? 'element' : 'elements'}`}
                {candidates.length > 0
                  ? ` · ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, candidates.length)} shown`
                  : ''}
              </p>
              {!candidates.length && (
                <p>No elements match. Clear the filters or choose another point.</p>
              )}
            </>
          )}
          <div className="toolbar">
            <div className="field">
              <Label htmlFor={kindId}>Element type</Label>
              <Select
                id={kindId}
                value={kind}
                disabled={imageState !== 'ready'}
                onChange={(event) => {
                  setKind(event.target.value);
                  setPage(0);
                  setSelectedId(undefined);
                }}
              >
                <option value="all">All element types</option>
                {elementKindLabels.map((label, code) => (
                  <option key={code} value={String(code)}>
                    {label}
                  </option>
                ))}
                <option value="unknown">Unknown (older capture)</option>
              </Select>
            </div>
            <div className="field">
              <Label htmlFor={searchId}>Find element number</Label>
              <Input
                id={searchId}
                value={query}
                placeholder="Element number"
                maxLength={10}
                disabled={imageState !== 'ready'}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPoint(null);
                  setPage(0);
                  setSelectedId(undefined);
                }}
              />
            </div>
            <Button variant="outline" onClick={clear} disabled={imageState !== 'ready'}>
              Show all captured elements
            </Button>
            <a href={url} target="_blank" rel="noopener">
              Open full-size element image
            </a>
          </div>
          {imageState === 'ready' && (
            <>
              <ul className="element-list">
                {visible.map((node) => (
                  <li key={node.id}>
                    <Button
                      variant="outline"
                      aria-pressed={selectedId === node.id}
                      onClick={() => setSelectedId(node.id)}
                    >
                      Inspect element {node.id}
                    </Button>
                    <span>
                      {node.kind === undefined ? 'Unknown type' : elementKindLabels[node.kind]} ·{' '}
                      {node.width.toFixed(2)} × {node.height.toFixed(2)} CSS px
                    </span>
                  </li>
                ))}
              </ul>
              {candidates.length > pageSize && (
                <div className="toolbar">
                  <Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>
                    Previous elements
                  </Button>
                  <Button
                    variant="outline"
                    disabled={(page + 1) * pageSize >= candidates.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next elements
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
