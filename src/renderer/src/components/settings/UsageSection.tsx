import { useEffect } from 'react';
import { useStore } from '../../store';
import { fmt } from '../UsageModal';

export function UsageSection() {
  const usage = useStore((s) => s.usage);
  const refresh = useStore((s) => s.refreshUsage);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const days = lastNDays(usage?.byDay ?? [], 14);
  const maxBar = Math.max(0.000001, ...days.map((d) => d.costUsd));

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Usage &amp; cost</h2>
        <p className="settings-pane-sub">
          Aggregated from <code>usage.jsonl</code> in your app-data directory.
          Every completed turn is recorded here.
        </p>
      </div>

      <div className="settings-pane-body">
        <div className="usage-top">
          <Tile label="Today" value={fmt(usage?.todayCostUsd ?? 0)} />
          <Tile label="Last 7 days" value={fmt(usage?.last7DaysCostUsd ?? 0)} />
          <Tile label="Lifetime" value={fmt(usage?.totalCostUsd ?? 0)} />
          <Tile label="Lifetime turns" value={String(usage?.totalTurns ?? 0)} />
        </div>

        <section className="usage-section">
          <h3>Last 14 days</h3>
          <div className="usage-bars" aria-hidden>
            {days.map((d) => (
              <div
                className="usage-bar-col"
                key={d.day}
                title={`${d.day} — ${fmt(d.costUsd)}`}
              >
                <div
                  className="usage-bar"
                  style={{ height: `${(d.costUsd / maxBar) * 100}%` }}
                />
                <div className="usage-bar-label">{d.day.slice(5)}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="usage-columns">
          <section className="usage-section">
            <h3>By agent</h3>
            {usage && usage.byAgent.length > 0 ? (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Turns</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byAgent.map((r) => (
                    <tr key={r.agent}>
                      <td>{r.agent}</td>
                      <td>{r.turns}</td>
                      <td>{fmt(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="usage-empty">No usage recorded yet.</div>
            )}
          </section>
          <section className="usage-section">
            <h3>By model</h3>
            {usage && usage.byModel.length > 0 ? (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Turns</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((r) => (
                    <tr key={r.model}>
                      <td>{r.model}</td>
                      <td>{r.turns}</td>
                      <td>{fmt(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="usage-empty">No usage recorded yet.</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-tile">
      <div className="usage-tile-label">{label}</div>
      <div className="usage-tile-value">{value}</div>
    </div>
  );
}

function lastNDays(
  byDay: Array<{ day: string; costUsd: number; turns: number }>,
  n: number,
): Array<{ day: string; costUsd: number; turns: number }> {
  const map = new Map(byDay.map((d) => [d.day, d]));
  const out: Array<{ day: string; costUsd: number; turns: number }> = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = toKey(d);
    out.push(map.get(key) ?? { day: key, costUsd: 0, turns: 0 });
  }
  return out;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
