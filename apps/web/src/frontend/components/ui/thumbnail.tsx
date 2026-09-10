import * as React from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * A screenshot, shown small.
 *
 * Pages, the review queue and a page's filmstrip all show the same thing — a
 * real capture, cropped to its top, at a fixed shape so a grid of them lines
 * up. One component so the crop, the empty state and the lazy loading are
 * decided once.
 *
 * Top-cropped rather than centred: a full-page screenshot is tall, and the
 * part a person recognises is the header, not the middle of the body.
 */
export function Thumbnail({
  src,
  alt,
  ratio = '16 / 10',
  fit = 'cover',
  className,
  overlay,
  empty = 'No screenshot yet',
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  src?: string;
  alt: string;
  /** CSS aspect-ratio. The grid uses one shape; a filmstrip frame is squarer. */
  ratio?: string;
  /**
   * `cover` crops to a recognisable slice — right for a grid of pages, where
   * the header is what identifies a page. `contain` shows the whole
   * screenshot — right for a before/after pair, where a reviewer is deciding
   * whether the page as a whole is correct and a phone capture cropped to its
   * navigation bar answers nothing.
   */
  fit?: 'cover' | 'contain';
  /** Corner content — a status pill, a count. Never interactive. */
  overlay?: React.ReactNode;
  empty?: React.ReactNode;
}) {
  const [failed, setFailed] = React.useState(false);
  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-muted)]',
        className,
      )}
      style={{ aspectRatio: ratio }}
      {...props}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn(
            'h-full w-full object-top',
            fit === 'contain' ? 'object-contain' : 'object-cover',
          )}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-[11px] text-[var(--foreground-muted)]">
          <ImageOff size={16} aria-hidden="true" />
          {failed ? 'Screenshot could not be loaded' : empty}
        </span>
      )}
      {overlay && <span className="absolute top-1.5 right-1.5 flex gap-1">{overlay}</span>}
    </div>
  );
}
