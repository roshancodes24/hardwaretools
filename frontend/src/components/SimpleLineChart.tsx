import type { CSSProperties } from "react";

export type LineChartPoint = { xLabel: string; y: number };

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  overflow: "hidden",
};

export function SimpleLineChart({
  title,
  subtitle,
  points,
  color,
  formatY,
}: {
  title: string;
  subtitle?: string;
  points: LineChartPoint[];
  color: string;
  formatY: (n: number) => string;
}) {
  const w = 640;
  const h = 220;
  const padL = 56;
  const padR = 14;
  const padT = 8;
  const padB = 40;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  if (points.length === 0) {
    return (
      <div style={{ ...cardStyle, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            {subtitle}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 24,
            fontSize: 13,
            color: "var(--muted)",
            textAlign: "center",
            padding: "24px 0",
          }}
        >
          No data in this range
        </div>
      </div>
    );
  }

  const ys = points.map((p) => p.y);
  const maxY = Math.max(1, ...ys);

  const n = points.length;
  const stepX = n <= 1 ? innerW / 2 : innerW / (n - 1);

  const coords = points.map((p, i) => {
    const px = padL + i * stepX;
    const py = padT + innerH * (1 - p.y / maxY);
    return { px, py, p };
  });

  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.px} ${c.py}`)
    .join(" ");

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = padT + innerH * (1 - t);
    return { y, label: formatY(maxY * t) };
  });

  const tickCount = Math.min(6, n);
  const tickStep = Math.max(1, Math.ceil(n / tickCount));
  const xTicks: { i: number; x: number }[] = [];
  for (let i = 0; i < n; i += tickStep) {
    xTicks.push({ i, x: padL + i * stepX });
  }
  if (n > 1 && xTicks[xTicks.length - 1]?.i !== n - 1) {
    xTicks.push({ i: n - 1, x: padL + (n - 1) * stepX });
  }

  return (
    <div style={cardStyle}>
      <div style={{ padding: "12px 14px 0" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      <div style={{ width: "100%", padding: "4px 8px 8px" }}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          role="img"
          aria-label={title}
        >
          {gridLines.map((g) => (
            <g key={g.y}>
              <line
                x1={padL}
                y1={g.y}
                x2={padL + innerW}
                y2={g.y}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.85}
              />
              <text
                x={padL - 8}
                y={g.y + 4}
                textAnchor="end"
                fill="var(--muted)"
                fontSize={10}
              >
                {g.label}
              </text>
            </g>
          ))}

          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {coords.map((c, idx) => (
            <circle
              key={idx}
              cx={c.px}
              cy={c.py}
              r={3.5}
              fill={color}
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          ))}

          {xTicks.map(({ i, x }) => (
            <text
              key={i}
              x={x}
              y={h - 10}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize={9}
            >
              {points[i]?.xLabel ?? ""}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
