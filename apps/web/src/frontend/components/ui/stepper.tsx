/** Progress bar segments for multi-step dialogs. */
export function Stepper({ total, current }: { total: number; current: number }) {
  return (
    <div className="stepper" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} data-done={index < current} />
      ))}
    </div>
  );
}
