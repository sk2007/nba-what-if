import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
  Brush
} from 'recharts';

// Collapse simultaneous events only for drawing; the inspector retains each event.
function mergeCurves(original, scenario) {
  const timeline = new Map();
  for (const point of original)
    timeline.set(point.gameSeconds, {
      ...timeline.get(point.gameSeconds),
      seconds: point.gameSeconds,
      original: point.wp
    });
  for (const point of scenario)
    timeline.set(point.gameSeconds, {
      ...timeline.get(point.gameSeconds),
      seconds: point.gameSeconds,
      scenario: point.wp
    });
  let originalWp = null,
    scenarioWp = null;
  return [...timeline.values()]
    .sort((a, b) => a.seconds - b.seconds)
    .map((point) => {
      originalWp = point.original ?? originalWp;
      scenarioWp = point.scenario ?? scenarioWp;
      return { ...point, original: originalWp, scenario: scenarioWp };
    });
}
function timeLabel(seconds) {
  const quarter =
    seconds < 2880
      ? Math.floor(seconds / 720) + 1
      : 5 + Math.floor((seconds - 2880) / 300);
  const remaining =
    (quarter <= 4 ? quarter * 720 : 2880 + (quarter - 4) * 300) - seconds;
  return `${quarter <= 4 ? `Q${quarter}` : `OT${quarter - 4}`} ${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, '0')}`;
}
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="studio-chart-tooltip">
      <strong>{timeLabel(Number(label))}</strong>
      {payload.map((entry) => (
        <div key={entry.dataKey}>
          <span>{entry.name}</span>
          <b>{Number(entry.value).toFixed(1)}%</b>
        </div>
      ))}
    </div>
  );
}

export default function ScenarioChart({
  original,
  scenario,
  hasChanges,
  pending,
  error,
  team,
  maxQuarter,
  selectedPlay,
  selectedWp,
  onSelectTime
}) {
  const data = useMemo(
    () =>
      mergeCurves(original, hasChanges && !pending && !error ? scenario : []),
    [original, scenario, hasChanges, pending, error]
  );
  const total = 2880 + Math.max(0, maxQuarter - 4) * 300;
  const ticks = [
    0,
    720,
    1440,
    2160,
    ...Array.from(
      { length: Math.max(0, maxQuarter - 4) },
      (_, index) => 2880 + index * 300
    ),
    total
  ];
  const periodLabel = (seconds) =>
    seconds === total
      ? 'End'
      : seconds < 2880
        ? `Q${Math.floor(seconds / 720) + 1}`
        : `OT${1 + Math.floor((seconds - 2880) / 300)}`;
  return (
    <section
      className="studio-panel studio-probability"
      aria-label={`${team} win probability comparison`}
    >
      <div className="studio-section-heading">
        <div>
          <p className="studio-eyebrow">Game flow</p>
          <h2>Win probability</h2>
          <p className="studio-muted">
            {team} · Click the curve to inspect a moment
          </p>
        </div>
        <div className="studio-chart-legend">
          <span>
            <i />
            Original
          </span>
          <span>
            <i className="scenario" />
            What if
          </span>
        </div>
      </div>
      <div
        className="studio-chart"
        role="group"
        aria-label="Win probability from zero to one hundred percent over game time"
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <LineChart
            data={data}
            margin={{ top: 14, right: 16, bottom: 0, left: -12 }}
            onClick={(state) => {
              const point =
                state?.activePayload?.[0]?.payload ??
                data[Number(state?.activeTooltipIndex)];
              if (point) onSelectTime(point.seconds);
            }}
          >
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="seconds"
              type="number"
              domain={[0, total]}
              ticks={ticks}
              tickFormatter={periodLabel}
              tick={{ fill: 'var(--slate)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={20}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value) => `${value}%`}
              tick={{ fill: 'var(--slate)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={50}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={50} stroke="var(--muted)" strokeDasharray="3 5" />
            <Line
              type="stepAfter"
              dataKey="original"
              name="Original"
              stroke="var(--chart-original)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {hasChanges && !pending && !error && (
              <Line
                type="stepAfter"
                dataKey="scenario"
                name="What if"
                stroke="var(--chart-scenario)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            {selectedPlay && (
              <ReferenceLine
                x={selectedPlay.gameSeconds}
                stroke="var(--slate)"
                strokeDasharray="3 4"
              />
            )}
            {selectedPlay && selectedWp != null && (
              <ReferenceDot
                x={selectedPlay.gameSeconds}
                y={selectedWp}
                r={4}
                fill="var(--chart-original)"
                stroke="var(--surface)"
              />
            )}
            <Brush
              dataKey="seconds"
              height={20}
              stroke="var(--line)"
              fill="var(--surface-soft)"
              tickFormatter={periodLabel}
              travellerWidth={8}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="studio-chart-footnote" role="status">
        {error
          ? 'Scenario could not be calculated. Try again from the editor.'
          : pending
            ? 'Recalculating your scenario…'
            : hasChanges
              ? 'Solid: original game · Dashed: your scenario · Drag the range to zoom'
              : 'Select a play and change its outcome to compare a scenario.'}
      </div>
    </section>
  );
}
