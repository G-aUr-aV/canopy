import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bytes, clock } from './api';
import type { Metrics } from './types';

export function Range({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <div className="range" aria-label="Chart time range">{[5, 15, 60].map(n => <button key={n} aria-pressed={value === n} onClick={() => onChange(n)}>{n === 60 ? '1h' : `${n}m`}</button>)}</div>;
}

export function Spark({ data, field, color }: { data: Metrics['history']; field: 'cpu' | 'memory'; color: string }) {
  return <div className="spark" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.slice(-45)} margin={{ top: 4, bottom: 2, left: 0, right: 0 }}><YAxis hide domain={[0, 100]} /><Area type="monotone" dataKey={field} stroke={color} fill={color} fillOpacity={0.06} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} /></AreaChart></ResponsiveContainer></div>;
}

export function HistoryChart({ metrics, minutes, onRange, kind = 'cpu' }: { metrics: Metrics; minutes: number; onRange: (n: number) => void; kind?: 'cpu' | 'network' | 'disk' }) {
  const pair = kind === 'cpu' ? ['cpu', 'memory'] : kind === 'network' ? ['rx', 'tx'] : ['disk_read', 'disk_write'];
  const names = kind === 'cpu' ? ['CPU', 'Memory'] : kind === 'network' ? ['Received', 'Sent'] : ['Read', 'Write'];
  const title = kind === 'cpu' ? 'CPU & memory' : kind === 'network' ? 'Network activity' : 'Disk activity';
  const points = metrics.history;
  const first = points[0]?.timestamp ?? metrics.timestamp;
  const last = Math.max(metrics.timestamp, first + 2);
  const start = last - minutes * 60;
  return <section className="history-section" aria-label={title}>
    <div className="section-heading"><h2>{title}</h2><Range value={minutes} onChange={onRange} /></div>
    <div className="history-chart">
      {points.length < 2 && <div className="chart-warming">Collecting history…</div>}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 15, right: 8, bottom: 4, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="#dce4df" strokeDasharray="3 4" />
          <XAxis dataKey="timestamp" type="number" domain={[start, last]} tickFormatter={clock} tickCount={5} axisLine={false} tickLine={false} minTickGap={35} tickMargin={12} />
          <YAxis width={kind === 'cpu' ? 40 : 65} domain={kind === 'cpu' ? [0, 100] : [0, 'auto']} tickCount={5} tickFormatter={value => kind === 'cpu' ? `${value}%` : bytes(value, 0)} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #dce4df', borderRadius: 7, fontSize: 13 }} labelFormatter={value => clock(Number(value))} formatter={(value, name) => [kind === 'cpu' ? `${Number(value).toFixed(1)}%` : `${bytes(Number(value))}/s`, name]} />
          <Line type="monotone" dataKey={pair[0]} name={names[0]} stroke="#23805e" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey={pair[1]} name={names[1]} stroke="#377bd2" strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <div className="chart-legend"><span><i className="dot green" />{names[0]}{kind === 'cpu' ? ' (%)' : ' (bytes/s)'}</span><span><i className="dot blue" />{names[1]}{kind === 'cpu' ? ` (% of ${bytes(metrics.memory.total)})` : ' (bytes/s)'}</span></div>
    {metrics.history_seconds < minutes * 60 - 5 && <p className="history-note">{durationLabel(metrics.history_seconds)} collected · history grows while the server is running</p>}
  </section>;
}
function durationLabel(seconds: number) { return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`; }
