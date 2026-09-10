// Single-series magnitude-over-time -- no legend needed (the title names the one series), bars
// capped at 24px with a rounded top / square baseline, values labeled at the cap since there
// are only ever a handful of months. Reuses --color-primary (already the app's one accent
// color) rather than introducing a new hue for a single-series chart.
import EmptyState from './EmptyState';

export default function BarChart({ data, labelKey, valueKey, formatValue = (v) => v }) {
  const max = Math.max(...data.map((d) => d[valueKey]), 1);

  if (data.length === 0) {
    return <EmptyState title="No data yet" hint="This chart fills in once there are records for the period." />;
  }

  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div key={d[labelKey]} className="bar-chart__column" title={`${d[labelKey]}: ${formatValue(d[valueKey])}`}>
          <div className="bar-chart__value">{formatValue(d[valueKey])}</div>
          <div className="bar-chart__bar" style={{ height: `${Math.max((d[valueKey] / max) * 100, 2)}%` }} />
          <div className="bar-chart__label">{d[labelKey]}</div>
        </div>
      ))}
    </div>
  );
}
