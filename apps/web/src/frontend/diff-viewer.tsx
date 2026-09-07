import { useId, useRef, useState } from 'react';
import type { Capture } from '../types';

const artifact = (runId: string, file: string) =>
  `/api/runs/${runId}/artifacts/${encodeURIComponent(file)}`;

function ViewerFigure({
  label,
  src,
  className,
  empty,
}: {
  label: string;
  src: string;
  className?: string;
  empty?: string;
}) {
  return (
    <figure className={className}>
      <figcaption>{label}</figcaption>
      {src ? (
        <a href={src} target="_blank" rel="noopener">
          <img alt={label} src={src} loading="lazy" decoding="async" />
        </a>
      ) : (
        <div className="placeholder">{empty ?? 'Image unavailable for this run.'}</div>
      )}
    </figure>
  );
}

/**
 * Interactive baseline/current comparison for one capture, after the review
 * workspaces of BackstopJS (scrubber) and Argos (swipe/onion blend): the static
 * three-pane grid becomes one pane with Side by side, Swipe and Overlay modes.
 * Local view state only — approval and coverage stay on the run card actions.
 */
export function DiffViewer({ capture, runId }: { capture: Capture; runId: string }) {
  const [mode, setMode] = useState<'side-by-side' | 'swipe' | 'overlay'>('side-by-side');
  const [position, setPosition] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const id = useId();
  const pane = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const comparable = !!capture.baselineRunId && !!capture.baselineFile && !!capture.file;
  const baselineSrc =
    capture.baselineFile && capture.baselineRunId
      ? artifact(capture.baselineRunId, capture.baselineFile)
      : '';
  const currentSrc = capture.file ? artifact(runId, capture.file) : '';
  const diffSrc = capture.diffFile ? artifact(runId, capture.diffFile) : '';
  const fromEvent = (clientX: number) => {
    const box = pane.current?.getBoundingClientRect();
    if (!box?.width) return;
    setPosition(Math.max(0, Math.min(100, ((clientX - box.left) / box.width) * 100)));
  };
  const modes: Array<{ value: 'side-by-side' | 'swipe' | 'overlay'; label: string }> = [
    { value: 'side-by-side', label: 'Side by side' },
    { value: 'swipe', label: 'Swipe' },
    { value: 'overlay', label: 'Overlay' },
  ];
  return (
    <section className="diff-viewer" aria-label="Visual comparison" data-mode={mode}>
      {comparable && (
        <div className="diff-modes" role="group" aria-label="Comparison view">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={mode === item.value}
              disabled={!comparable && item.value !== 'side-by-side'}
              onClick={() => setMode(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {!comparable ? (
        <div className="compare">
          <ViewerFigure
            label="Capture from this run"
            src={currentSrc}
            className="diff-full"
            empty="Capture image unavailable for this run."
          />
          <ViewerFigure
            label="Pixel difference"
            src={diffSrc}
            className="diff-full"
            empty={
              capture.status === 'needs-baseline'
                ? 'No comparison was made because this run had no prior baseline.'
                : 'Difference image unavailable for this run.'
            }
          />
        </div>
      ) : mode === 'side-by-side' ? (
        <div className="compare">
          <ViewerFigure label="Baseline used for this run" src={baselineSrc} />
          <ViewerFigure label="Capture from this run" src={currentSrc} />
          <ViewerFigure
            label="Pixel difference"
            src={diffSrc}
            className="diff-full"
            empty="Difference image unavailable for this run."
          />
        </div>
      ) : mode === 'swipe' ? (
        <div
          className="diff-swipe"
          ref={pane}
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            fromEvent(event.clientX);
          }}
          onPointerMove={(event) => {
            if (dragging.current) fromEvent(event.clientX);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
        >
          <img
            alt="Baseline used for this run"
            src={baselineSrc}
            draggable={false}
            decoding="async"
          />
          <img
            alt="Capture from this run"
            src={currentSrc}
            draggable={false}
            decoding="async"
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
          />
          <div
            className="diff-divider"
            role="slider"
            aria-label="Comparison position"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position)}
            aria-orientation="vertical"
            tabIndex={0}
            style={{ left: `${position}%` }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setPosition((old) => Math.max(0, Math.round(old) - 5));
              if (event.key === 'ArrowRight')
                setPosition((old) => Math.min(100, Math.round(old) + 5));
            }}
          />
        </div>
      ) : (
        <div className="diff-overlay">
          <img
            alt="Baseline used for this run"
            src={baselineSrc}
            draggable={false}
            decoding="async"
          />
          <img
            alt="Capture from this run"
            src={currentSrc}
            draggable={false}
            decoding="async"
            style={{ opacity: opacity / 100 }}
          />
          <label htmlFor={`${id}-opacity`}>
            Overlay opacity
            <input
              id={`${id}-opacity`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={opacity}
              onChange={(event) => setOpacity(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      )}
    </section>
  );
}
