// Shimmer placeholder shown while a list loads, in place of the bare "Loading..." text.
// Renders `rows` x `cols` animated bars; the shimmer is disabled under prefers-reduced-motion
// by the global rule in index.css.
export default function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <span className="skeleton skeleton-cell" key={c} />
          ))}
        </div>
      ))}
    </div>
  );
}
