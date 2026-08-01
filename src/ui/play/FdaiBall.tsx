// SPDX-License-Identifier: GPL-3.0-or-later
//
// M4.11 — FDAI (Flight Director / Attitude Indicator) "8-ball".
//
// MODELLING NOTE
// --------------
// Presentation only. The LM carried two FDAIs (commander and LMP) driven by
// the IMU CDU angles, with three edge-mounted rate needles (roll across the
// top, pitch down the right side, yaw across the bottom) and an OFF flag that
// drops into view when the ball has no valid drive signal.
//
// The flight kernel is planar, so it has exactly one physical attitude axis:
// the thrust-axis angle from local vertical, which this instrument shows as
// PITCH. Roll is the cockpit windows-down -> windows-up orientation state.
// Yaw is not modelled, so its needle is parked at zero and labelled as such
// rather than being animated with invented data.

const R = 92;

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap to (-180, 180] so the ball never spins the long way round. */
export function wrapDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(d, -180)) d = 180;
  return d;
}

function pitchLadder() {
  const rows: { y: number; deg: number; major: boolean }[] = [];
  for (let deg = -180; deg <= 180; deg += 10) {
    rows.push({ y: (-deg * R) / 90, deg, major: deg % 30 === 0 });
  }
  return rows;
}

const LADDER = pitchLadder();
const MERIDIANS = [-60, -40, -20, 0, 20, 40, 60];

function RateTape({
  orientation,
  value,
  full,
  label,
  inert,
  testid,
}: {
  orientation: "horizontal" | "vertical";
  value: number;
  full: number;
  label: string;
  inert?: boolean;
  testid: string;
}) {
  const frac = clamp(value / full, -1, 1);
  const ticks = [-1, -0.6, -0.2, 0.2, 0.6, 1];
  const horizontal = orientation === "horizontal";
  const len = 150;
  const thick = 16;
  const w = horizontal ? len : thick;
  const h = horizontal ? thick : len;
  const pos = ((frac + 1) / 2) * (len - 8) + 4;

  return (
    <g data-testid={testid} data-rate={value.toFixed(3)}>
      <rect
        width={w}
        height={h}
        rx="2"
        className={inert ? "fill-neutral-800 stroke-neutral-700" : "fill-neutral-300 stroke-neutral-500"}
        strokeWidth="0.75"
      />
      {ticks.map((t) => {
        const p = ((t + 1) / 2) * (len - 8) + 4;
        return horizontal ? (
          <line
            key={t}
            x1={p}
            y1={thick}
            x2={p}
            y2={thick - 5}
            className={inert ? "stroke-neutral-600" : "stroke-neutral-700"}
            strokeWidth="1"
          />
        ) : (
          <line
            key={t}
            x1={0}
            y1={p}
            x2={5}
            y2={p}
            className={inert ? "stroke-neutral-600" : "stroke-neutral-700"}
            strokeWidth="1"
          />
        );
      })}
      {horizontal ? (
        <line x1={len / 2} y1={2} x2={len / 2} y2={thick - 2} className="stroke-neutral-600" strokeWidth="1" />
      ) : (
        <line x1={2} y1={len / 2} x2={thick - 2} y2={len / 2} className="stroke-neutral-600" strokeWidth="1" />
      )}
      {horizontal ? (
        <polygon
          points={`${pos - 5},0 ${pos + 5},0 ${pos},7`}
          className={inert ? "fill-neutral-600" : "fill-neutral-900"}
        />
      ) : (
        <polygon
          points={`${thick},${pos - 5} ${thick},${pos + 5} ${thick - 7},${pos}`}
          className={inert ? "fill-neutral-600" : "fill-neutral-900"}
        />
      )}
      <title>{label}</title>
    </g>
  );
}

export function FdaiBall({
  pitchDeg,
  rollDeg,
  pitchRateDegPerSec,
  rollRateDegPerSec,
  valid = true,
}: {
  /** Thrust axis angle from local vertical, degrees. */
  pitchDeg: number;
  /** Cockpit roll orientation, degrees (0 = windows up). */
  rollDeg: number;
  pitchRateDegPerSec: number;
  rollRateDegPerSec: number;
  valid?: boolean;
}) {
  const pitch = wrapDeg(pitchDeg);
  const roll = wrapDeg(rollDeg);
  const ballY = (pitch * R) / 90;

  return (
    <section
      data-testid="fdai"
      data-pitch={pitch.toFixed(2)}
      data-roll={roll.toFixed(2)}
      className="rounded-lg border border-border bg-card p-3"
      aria-label="Flight director attitude indicator"
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          FDAI · attitude
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {valid ? "IMU" : "no att"}
        </span>
      </header>

      <svg
        viewBox="0 0 250 250"
        className="mx-auto block w-full max-w-[280px]"
        role="img"
        aria-label={`Pitch ${pitch.toFixed(0)} degrees from vertical, roll ${roll.toFixed(0)} degrees`}
      >
        <defs>
          <clipPath id="fdai-ball-clip">
            <circle cx="0" cy="0" r={R} />
          </clipPath>
          <radialGradient id="fdai-shade" cx="38%" cy="32%" r="78%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
            <stop offset="62%" stopColor="#000000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.55" />
          </radialGradient>
        </defs>

        {/* Instrument case */}
        <polygon
          points="35,4 215,4 246,35 246,215 215,246 35,246 4,215 4,35"
          className="fill-neutral-900 stroke-neutral-700"
          strokeWidth="1.5"
        />
        {[
          [22, 22],
          [228, 22],
          [22, 228],
          [228, 228],
        ].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" className="fill-neutral-700" />
        ))}
        <circle cx="125" cy="125" r={R + 12} className="fill-black stroke-neutral-800" strokeWidth="2" />

        <g transform="translate(125 125)">
          <g clipPath="url(#fdai-ball-clip)">
            <circle cx="0" cy="0" r={R} className="fill-neutral-200" />
            <g transform={`rotate(${-roll})`}>
              <g transform={`translate(0 ${ballY})`}>
                {/* Upper (sky-side) hemisphere is the dark half of the ball. */}
                <rect x={-2 * R} y={-4 * R} width={4 * R} height={4 * R} fill="#111318" />
                <rect x={-2 * R} y={0} width={4 * R} height={4 * R} fill="#e8e6e0" />
                <line x1={-2 * R} y1="0" x2={2 * R} y2="0" stroke="#8a8681" strokeWidth="1.4" />

                {LADDER.map((row) => {
                  const dark = row.y < 0;
                  const stroke = dark ? "#6f7480" : "#9a968f";
                  const half = row.major ? 46 : 24;
                  return (
                    <g key={row.deg}>
                      <line
                        x1={-half}
                        y1={row.y}
                        x2={half}
                        y2={row.y}
                        stroke={stroke}
                        strokeWidth={row.major ? 1 : 0.6}
                      />
                      {row.major && row.deg !== 0 && (
                        <text
                          x={-half - 5}
                          y={row.y + 3.2}
                          textAnchor="end"
                          fontSize="8"
                          fontFamily="ui-monospace, monospace"
                          fill={dark ? "#8d93a0" : "#7d7972"}
                        >
                          {Math.abs(row.deg)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {MERIDIANS.map((m) => (
                  <ellipse
                    key={m}
                    cx="0"
                    cy="0"
                    rx={Math.max(2, (Math.abs(Math.sin((m * Math.PI) / 180)) * R) || 1)}
                    ry={R}
                    fill="none"
                    stroke="#8d8f95"
                    strokeOpacity={m === 0 ? 0.85 : 0.4}
                    strokeWidth={m === 0 ? 1.2 : 0.6}
                  />
                ))}
              </g>
            </g>
            <circle cx="0" cy="0" r={R} fill="url(#fdai-shade)" />
          </g>

          {/* Roll index scale around the ball */}
          {Array.from({ length: 36 }, (_, i) => i * 10).map((deg) => {
            const a = ((deg - 90) * Math.PI) / 180;
            const major = deg % 30 === 0;
            const r0 = R + 2;
            const r1 = R + (major ? 10 : 6);
            return (
              <line
                key={deg}
                x1={Math.cos(a) * r0}
                y1={Math.sin(a) * r0}
                x2={Math.cos(a) * r1}
                y2={Math.sin(a) * r1}
                className="stroke-neutral-500"
                strokeWidth={major ? 1.4 : 0.7}
              />
            );
          })}
          <g transform={`rotate(${roll})`}>
            <polygon points={`0,${-R - 3} -6,${-R - 13} 6,${-R - 13}`} className="fill-amber-400" />
          </g>

          {/* Fixed vehicle symbol */}
          <line x1="-52" y1="0" x2="-14" y2="0" stroke="#f5c542" strokeWidth="3" />
          <line x1="14" y1="0" x2="52" y2="0" stroke="#f5c542" strokeWidth="3" />
          <line x1="0" y1="-14" x2="0" y2="-40" stroke="#f5c542" strokeWidth="3" />
          <circle cx="0" cy="0" r="4" fill="none" stroke="#f5c542" strokeWidth="2.5" />

          {!valid && (
            <g data-testid="fdai-off-flag">
              <rect x="-84" y="-16" width="42" height="32" rx="3" fill="#c0392b" transform="rotate(-14)" />
              <text
                x="-63"
                y="6"
                textAnchor="middle"
                transform="rotate(-14)"
                fontSize="17"
                fontFamily="ui-monospace, monospace"
                fontWeight="700"
                fill="#fff"
              >
                OFF
              </text>
            </g>
          )}
        </g>

        {/* Rate needles: roll (top), pitch (right), yaw (bottom, unmodelled) */}
        <g transform="translate(50 12)">
          <RateTape
            orientation="horizontal"
            value={rollRateDegPerSec}
            full={20}
            label="Roll rate, deg/s"
            testid="fdai-roll-rate"
          />
        </g>
        <g transform="translate(222 50)">
          <RateTape
            orientation="vertical"
            value={-pitchRateDegPerSec}
            full={20}
            label="Pitch rate, deg/s"
            testid="fdai-pitch-rate"
          />
        </g>
        <g transform="translate(50 222)">
          <RateTape
            orientation="horizontal"
            value={0}
            full={20}
            label="Yaw rate — not modelled by the planar kernel"
            inert
            testid="fdai-yaw-rate"
          />
        </g>

        <text x="125" y="9" textAnchor="middle" fontSize="7" fontFamily="ui-monospace, monospace" fill="#8b8b8b">
          ROLL RATE
        </text>
        <text
          x="243"
          y="125"
          textAnchor="middle"
          fontSize="7"
          fontFamily="ui-monospace, monospace"
          fill="#8b8b8b"
          transform="rotate(90 243 125)"
        >
          PITCH RATE
        </text>
        <text x="125" y="245" textAnchor="middle" fontSize="7" fontFamily="ui-monospace, monospace" fill="#5f5f5f">
          YAW RATE
        </text>
      </svg>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Field label="Pitch" value={`${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)}°`} testid="fdai-pitch-readout" />
        <Field label="Roll" value={`${roll.toFixed(0)}°`} testid="fdai-roll-readout" />
        <Field
          label="Pitch rate"
          value={`${pitchRateDegPerSec >= 0 ? "+" : ""}${pitchRateDegPerSec.toFixed(1)}°/s`}
          testid="fdai-rate-readout"
        />
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Planar kernel: pitch is the thrust axis off local vertical, roll is the windows-up
        orientation. Yaw is not modelled and its needle stays caged.
      </p>
    </section>
  );
}

function Field({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-black/50 px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="font-mono text-sm tabular-nums text-neutral-100" data-testid={testid}>
        {value}
      </div>
    </div>
  );
}
