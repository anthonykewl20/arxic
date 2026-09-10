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
 * workspaces of BackstopJS (scrubber) and Argos (swipe/onion blend, changed
 * regions): the static three-pane grid becomes one pane with Side by side,
 * Swipe and Overlay modes, plus an overlay of changed-region boxes that can be
 * walked from the keyboard. Local view state only — approval and coverage stay
 * on the run card actions.
 */
export function DiffViewer({ capture, runId }: { capture: Capture; runId: string }) {
  const [mode, setMode] = useState<'side-by-side' | 'swipe' | 'overlay'>('side-by-side');
  const [position, setPosition] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const [showRegions, setShowRegions] = useState(false);
  const [activeRegion, setActiveRegion] = useState<number | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const id = useId();
  const pane = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const comparable = !!capture.baselineRunId && !!capture.baselineFile && !!capture.file;
  const regions = capture.diffRegions ?? [];
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
  const stepRegion = (direction: 1 | -1) => {
    if (!regions.length) return;
    setShowRegions(true);
    setActiveRegion((old) => {
      if (old === null) return direction === 1 ? 0 : regions.length - 1;
      return (old + direction + regions.length) % regions.length;
    });
  };
  const regionStyle = (region: { x: number; y: number; width: number; height: number }) =>
    imageSize
      ? {
          left: `${(region.x / imageSize.width) * 100}%`,
          top: `${(region.y / imageSize.height) * 100}%`,
          width: `${(region.width / imageSize.width) * 100}%`,
          height: `${(region.height / imageSize.height) * 100}%`,
        }
      : undefined;
  const regionLayer = (className: string) =>
    showRegions &&
    imageSize &&
    regions.length > 0 && (
      <div className={className}>
        {regions.map((region, index) => (
          <div
            key={index}
            className={`diff-region ${activeRegion === index ? 'is-active' : ''}`}
            style={regionStyle(region)}
            {...(activeRegion === index ? { 'aria-current': 'true' } : {})}
            ref={
              activeRegion === index
                ? (element) => element?.scrollIntoView({ block: 'nearest' })
                : undefined
            }
          />
        ))}
      </div>
    );
  const modes: Array<{ value: 'side-by-side' | 'swipe' | 'overlay'; label: string }> = [
    { value: 'side-by-side', label: 'Side by side' },
    { value: 'swipe', label: 'Swipe' },
    { value: 'overlay', label: 'Overlay' },
  ];
  return (
    <section
      className="diff-viewer"
      aria-label="Visual comparison"
      data-mode={mode}
      tabIndex={-1}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        if (event.key === '1' && comparable) setMode('side-by-side');
        else if (event.key === '2' && comparable) setMode('swipe');
        else if (event.key === '3' && comparable) setMode('overlay');
        else if (event.key === 'n') stepRegion(1);
        else if (event.key === 'p') stepRegion(-1);
      }}
    >
      {comparable && (
        <div className="diff-modes" role="group" aria-label="Comparison view">
          {modes.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={mode === item.value}
              onClick={() => setMode(item.value)}
            >
              {item.label}
            </button>
          ))}
          {regions.length > 0 && (
            <>
              <span className="diff-region-count">
                {regions.length} change {regions.length === 1 ? 'region' : 'regions'}
              </span>
              <button
                type="button"
                aria-pressed={showRegions}
                onClick={() => {
                  setShowRegions((old) => !old);
                  setActiveRegion(null);
                }}
              >
                Changes
              </button>
              <button type="button" onClick={() => stepRegion(1)}>
                Next change
              </button>
              <button type="button" onClick={() => stepRegion(-1)}>
                Previous change
              </button>
              {activeRegion !== null && (
                <span className="diff-region-counter">
                  {activeRegion + 1} / {regions.length}
                </span>
              )}
            </>
          )}
        </div>
      )}
      {/*
        The measurement behind the comparison: region coverage percentages and
        detector verdicts. Precise, and unreadable as a first impression —
        this used to sit between the reviewer and the two pictures they came
        to compare. It stays exactly as it was, one disclosure away.
      */}
      {capture.diffExplanation && regions.length > 0 && (
        <details>
          <summary>Show the measurement behind this comparison</summary>
          <ul
            className="diff-evidence"
            aria-label="Deterministic change evidence"
            data-evidence-bound={capture.diffExplanation.assessmentSha256}
          >
            {(activeRegion !== null ? [activeRegion] : regions.map((_, index) => index)).map(
              (index) => {
                const evidence = capture.diffExplanation?.regions[index];
                if (!evidence) return null;
                return (
                  <li
                    key={index}
                    data-region-evidence={index}
                    data-unexplained={evidence.unexplained}
                  >
                    <span>
                      Region {index + 1}
                      {evidence.unexplained
                        ? ' — unexplained paint change (no measured element)'
                        : ''}
                    </span>
                    {evidence.elements.length > 0 && (
                      <span>
                        {evidence.elements
                          .map(
                            (element) => `${element.label} ${Math.round(element.coverage * 100)}%`,
                          )
                          .join(', ')}
                      </span>
                    )}
                    {evidence.checks.length > 0 && (
                      <span>
                        {evidence.checks
                          .map((check) => `${check.id} (${check.verdict})`)
                          .join(', ')}
                      </span>
                    )}
                  </li>
                );
              },
            )}
            {(capture.diffExplanation.documentChecks?.length ?? 0) > 0 && (
              <li data-document-checks>
                {capture.diffExplanation.documentChecks
                  .map((check) => `${check.id} (${check.verdict})`)
                  .join(', ')}
              </li>
            )}
          </ul>
        </details>
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
          <figure>
            <figcaption>Capture from this run</figcaption>
            <div className="diff-image-frame">
              <a href={currentSrc} target="_blank" rel="noopener">
                <img
                  alt="Capture from this run"
                  src={currentSrc}
                  loading="lazy"
                  decoding="async"
                  onLoad={(event) =>
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                />
              </a>
              {regionLayer('diff-regions')}
            </div>
          </figure>
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
            onLoad={(event) =>
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          {regionLayer('diff-regions')}
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
            onLoad={(event) =>
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          {regionLayer('diff-regions')}
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
