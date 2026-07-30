// SPDX-License-Identifier: GPL-3.0-or-later
//
// M3.3C Phase 4A — Source-derived fixed-attitude IMU bootstrap.
//
// PURE MODULE. No WASM, no Worker, no I/O, no mutable module state.
//
// This file encodes the coordinate chain proven in
// docs/M3_3C_PHASE4A_COORDINATE_CHAIN.md against the pinned rope
// chrislgarry/Apollo-11 @ 911e5c0283c629c50cb97666f34065e8c07d71a5.
//
// It is NOT an arbitrary identity shortcut. The scenario REFERENCE frame is
// *defined* to be the Luminary landing-site stable-member orientation
// (P51-P53.agc `P52LS` / `LSORIENT`, IMU orientation option 4), so REFSMMAT
// is identity BECAUSE the reference triad and the stable-member triad were
// deliberately chosen to be the same triad — the numerical identity is the
// consequence of the coordinate definition, not the cause of it.
//
// Nothing in this module is wired into the Worker. Installing these erasable
// words into a live rope requires a source-legitimate uplink/pad-load path
// that does not yet exist in HW-I/O v3 (see `BOOTSTRAP_INSTALLATION_BLOCKER`).

import type { AgcMonitorProfile } from "./types";

// ---------------------------------------------------------------------------
// Small pure linear algebra (row-major, matching the AGC interpreter's MXV)
// ---------------------------------------------------------------------------

export type Vec3 = readonly [number, number, number];
/** Row-major 3x3: [r0c0, r0c1, r0c2, r1c0, ... r2c2]. This is the storage
 *  order Luminary uses for REFSMMAT — see `MXV` in INTERPRETER.agc:1140,
 *  which sets DOTINC = 2 (contiguous DP words) so each dot product consumes
 *  one CONTIGUOUS ROW of the matrix. `VXM` (INTERPRETER.agc:1144) sets
 *  DOTINC = 6, i.e. columns, and is used wherever Luminary transforms the
 *  other way (R31.agc:233 "CHANGE TO REFERENCE SYSTEM"). */
export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const IDENTITY_MATRIX3: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** m · v — the operation Luminary spells `MXV`. */
export function matVec(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** mᵀ · v — the operation Luminary spells `VXM`. */
export function transposeMatVec(m: Matrix3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

export function transpose(m: Matrix3): Matrix3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function matMul(a: Matrix3, b: Matrix3): Matrix3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    }
  }
  return out as unknown as Matrix3;
}

export function determinant(m: Matrix3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Max abs deviation of mᵀm from the identity. 0 => perfectly orthonormal. */
export function orthonormalityDefect(m: Matrix3): number {
  const p = matMul(transpose(m), m);
  let worst = 0;
  for (let i = 0; i < 9; i++) {
    const want = i % 4 === 0 ? 1 : 0;
    worst = Math.max(worst, Math.abs(p[i] - want));
  }
  return worst;
}

export function isRightHandedOrthonormal(m: Matrix3, tol = 1e-12): boolean {
  return orthonormalityDefect(m) <= tol && Math.abs(determinant(m) - 1) <= tol;
}

// ---------------------------------------------------------------------------
// CDU counter representation — PROVEN
// ---------------------------------------------------------------------------
//
// Addresses: Luminary099/ERASABLE_ASSIGNMENTS.agc:117-119
//   CDUX EQUALS 32 / CDUY EQUALS 33 / CDUZ EQUALS 34  (octal).
//
// Representation: SERVICER.agc:576-581 (`PIPASR`) reads the three counters
// with a bare `CA CDUX` … `TS CDUTEMPX` at PIPA time — a PLAIN COUNTER READ.
// The counters are NOT drained, cleared, or acknowledged (contrast the PIPAs
// two instructions earlier, which ARE explicitly zeroed with `DXCH PIPAX`).
//
// Scale: POWERED_FLIGHT_SUBROUTINES.agc:77 (`CDUTRIGS`) feeds the raw counter
// word to `CDULOGIC`, whose header (INTERPRETER.agc, "CONVERT THE DP 1'S
// COMPLEMENT ANGLE SCALED IN REVOLUTIONS TO A SINGLE PRECISION 2'S COMPLEMENT
// ANGLE SCALED IN HALF-REVOLUTIONS") fixes the counter word as a 15-bit
// TWO'S-COMPLEMENT angle scaled at HALF A REVOLUTION (180 deg) full scale.
// Same statement appears verbatim on the matching output registers,
// ERASABLE_ASSIGNMENTS.agc:1927-1929 ("SCALED AT PI RADIANS (180 DEGREES)
// (STORE IN 2'S COMPLEMENT)").

export const CDUX_ADDRESS = 0o32;
export const CDUY_ADDRESS = 0o33;
export const CDUZ_ADDRESS = 0o34;

/** One CDU count in degrees: 180 / 2^14. */
export const CDU_DEGREES_PER_COUNT = 180 / 16384;
/** A full revolution is 2^15 counts; the counter wraps naturally. */
export const CDU_COUNTS_PER_REVOLUTION = 32768;

/** Decode a raw 15-bit two's-complement CDU counter word to degrees. */
export function cduCountsToDegrees(word: number): number {
  const w = ((word % CDU_COUNTS_PER_REVOLUTION) + CDU_COUNTS_PER_REVOLUTION) %
    CDU_COUNTS_PER_REVOLUTION;
  const signed = w >= 16384 ? w - CDU_COUNTS_PER_REVOLUTION : w;
  return signed * CDU_DEGREES_PER_COUNT;
}

/** Encode degrees into the raw 15-bit two's-complement CDU counter word. */
export function degreesToCduCounts(deg: number): number {
  const raw = Math.round(deg / CDU_DEGREES_PER_COUNT);
  return ((raw % CDU_COUNTS_PER_REVOLUTION) + CDU_COUNTS_PER_REVOLUTION) %
    CDU_COUNTS_PER_REVOLUTION;
}

/**
 * XNB — the navigation-base(=LM body) -> stable-member matrix, built from the
 * three gimbal angles exactly as Luminary does.
 *
 * PROVEN DIRECTLY: Luminary099/POWERED_FLIGHT_SUBROUTINES.agc:307 names the
 * result "THE BODY-STABLE MEMBER TRANSFORMATION MATRIX (COMMONLY CALLED XNB)"
 * — Luminary makes no distinction between navigation-base and LM body axes.
 * The first row is computed literally at :326-345 as
 *     ( cosY cosZ , sinZ , -sinY cosZ )
 * (the `DDOUBL`s are the B-1 half-unit rescale, not part of the geometry).
 *
 * Rows 2 and 3 below are the UNIQUE right-handed orthonormal completion of
 * that first row for the outer/inner/middle (X/Y/Z) gimbal sequence; the test
 * suite asserts row 1 against the literal source expression and asserts
 * orthonormality and det = +1, so a sign or ordering error cannot pass.
 */
export function xnbFromCduDegrees(xDeg: number, yDeg: number, zDeg: number): Matrix3 {
  const d = Math.PI / 180;
  const sx = Math.sin(xDeg * d), cx = Math.cos(xDeg * d);
  const sy = Math.sin(yDeg * d), cy = Math.cos(yDeg * d);
  const sz = Math.sin(zDeg * d), cz = Math.cos(zDeg * d);
  return [
    cy * cz, sz, -sy * cz,
    sx * sy - cx * cy * sz, cx * cz, sx * cy + cx * sy * sz,
    cx * sy + sx * cy * sz, -sx * cz, cx * cy - sx * sy * sz,
  ];
}

// ---------------------------------------------------------------------------
// REFSMMAT storage — PROVEN
// ---------------------------------------------------------------------------
//
// Direction: "REFSMMAT  MATRIX FROM REFERENCE TO STABLE-MEMBER COORDINATES
// SCALED AT 2." (Luminary099/P40-P47.agc:815); corroborated at R63.agc:117
// "(REFSMAT X LOS). TRANSFORMS LOS FROM REFERENCE COORD TO STAB MEMB COORD."
// Every forward use is `MXV REFSMMAT` (P40-P47.agc:833, R63.agc:116,
// THE_LUNAR_LANDING.agc:85 and :114); the reverse direction uses
// `VXM REFSMMAT` (R31.agc:232).
//
// Scale: "SCALED AT 2" == every element is stored halved (B-1, "half-unit
// matrix"), which is why every MXV is immediately followed by `VSL1`
// (P40-P47.agc:833 "…(RESCALE)", :1468 "RESCALE DUE TO HALF-UNIT MATRIX").
//
// Storage: 18 erasable words = 9 double-precision elements, ROW MAJOR
// (INTERPRETER.agc:1140 MXV -> DOTINC 2 -> contiguous rows).
//
// Address: ERASABLE_ASSIGNMENTS.agc:958 `REFSMMAT ERASE +17D`, resolved by
// yaYUL against the pinned rope to E3,1733 => ECADR 0o1733 (18 words,
// 0o1733..0o1754). Corroborated by DOWNLINK_LISTS.agc:80 `6DNADR REFSMMAT`.

export const REFSMMAT_ECADR = 0o1733;
export const REFSMMAT_WORD_COUNT = 18;
export const REFSMMAT_EBANK = 3;

/** FLAGWRD3 = STATE +3; STATE resolves to 0o74 in the pinned rope. */
export const FLAGWRD3_ADDRESS = 0o77;
/** REFSMFLG = flag 047D = FLAGWRD3 bit 13 (FLAGWORD_ASSIGNMENTS.agc:467-468).
 *  Marked "*** PROTECTED FROM FRESH START ***" — i.e. Luminary itself treats
 *  a known IMU orientation as state that survives from before the program
 *  starts, which is exactly what a bootstrap represents. */
export const REFSMFLG_MASK = 0o10000;

/** AGC double-precision word pair for a value in [-1, 1). */
export interface AgcDpWords {
  readonly hi: number;
  readonly lo: number;
}

/**
 * Encode a matrix element (a pure number in [-1, 1]) into the B-1 half-unit
 * double-precision word pair Luminary stores in REFSMMAT.
 */
export function encodeRefsmmatElement(value: number): AgcDpWords {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(`REFSMMAT element out of range: ${value}`);
  }
  const halved = value / 2; // "SCALED AT 2"
  const total = Math.round(halved * 2 ** 28);
  const magnitude = Math.abs(total);
  const hiMag = Math.floor(magnitude / 2 ** 14);
  const loMag = magnitude - hiMag * 2 ** 14;
  // AGC words are ones' complement: negate by bitwise complement in 15 bits.
  const enc = (m: number) => (total < 0 ? (~m) & 0o77777 : m);
  return { hi: enc(hiMag), lo: enc(loMag) };
}

/** Decode a B-1 half-unit DP word pair back to a pure matrix element. */
export function decodeRefsmmatElement(words: AgcDpWords): number {
  const neg = (words.hi & 0o40000) !== 0;
  const hiMag = neg ? (~words.hi) & 0o77777 : words.hi;
  const loMag = neg ? (~words.lo) & 0o77777 : words.lo;
  const mag = (hiMag * 2 ** 14 + loMag) / 2 ** 28;
  return (neg ? -mag : mag) * 2;
}

/** Serialise a row-major matrix into the 18 REFSMMAT erasable words. */
export function refsmmatToWords(m: Matrix3): readonly number[] {
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    const { hi, lo } = encodeRefsmmatElement(m[i]);
    out.push(hi, lo);
  }
  return out;
}

/** Inverse of `refsmmatToWords`. */
export function wordsToRefsmmat(words: readonly number[]): Matrix3 {
  if (words.length !== REFSMMAT_WORD_COUNT) {
    throw new RangeError(`REFSMMAT needs ${REFSMMAT_WORD_COUNT} words, got ${words.length}`);
  }
  const out: number[] = [];
  for (let i = 0; i < 9; i++) {
    out.push(decodeRefsmmatElement({ hi: words[i * 2], lo: words[i * 2 + 1] }));
  }
  return out as unknown as Matrix3;
}

// ---------------------------------------------------------------------------
// Bootstrap definition
// ---------------------------------------------------------------------------

export interface SourceCitation {
  readonly claim: string;
  readonly source: string;
}

export interface SourceMappedInitializer {
  readonly symbol: string;
  /** Erasable address (decimal here; documented as octal in `note`). */
  readonly address: number;
  /** Raw 15-bit AGC word to be installed. */
  readonly rawWord: number;
  /** Human-readable decoded value. */
  readonly decodedValue: string;
  readonly scale: string;
  readonly sourceCitation: string;
  /** Why this word ALREADY holds this value when the scenario begins. */
  readonly priorStateReason: string;
  /** Deterministic application order (ascending, dense from 0). */
  readonly applyOrder: number;
}

export interface SourceMappedCoordinateConvention {
  readonly id: string;
  /** How the scenario reference frame axes are DEFINED. */
  readonly referenceFrame: {
    readonly xAxis: string;
    readonly yAxis: string;
    readonly zAxis: string;
    readonly handedness: "right";
    readonly sourceCitation: string;
  };
  readonly stableMemberFrame: string;
  readonly bodyFrame: string;
  readonly thrustAxisBody: Vec3;
  readonly pipaAxisAssignment: string;
}

export interface FixedAttitudeImuBootstrapV1 {
  readonly id: "luminary099-fixed-attitude-imu-v1";
  readonly coordinateConvention: SourceMappedCoordinateConvention;
  readonly refsmmat: Matrix3;
  readonly refsmmatWords: readonly SourceMappedInitializer[];
  readonly initialCduCounts: Readonly<{ x: number; y: number; z: number }>;
  readonly bodyToStableMember: Matrix3;
  readonly stableMemberSpecificForceAxis: Vec3;
  readonly citations: readonly SourceCitation[];
  readonly limitations: readonly string[];
  /** Profiles this bootstrap is a prerequisite of. */
  readonly requiredForProfiles: readonly AgcMonitorProfile[];
}

const REFERENCE_FRAME: SourceMappedCoordinateConvention["referenceFrame"] = {
  xAxis:
    "UNIT(RLS) — the landing-site radius vector expressed in reference coordinates at TLAND.",
  yAxis: "UNIT(Z_ref x X_ref) — completes the triad.",
  zAxis:
    "UNIT((R_other x V_other) x X_ref) — the orbit-normal component orthogonalised against X.",
  handedness: "right",
  sourceCitation:
    "Luminary099/P51-P53.agc:248-268 (P52LS, IMU orientation option 4: XSMD = UNIT(RLS in reference coords)) and :LSORIENT (ZSMD = UNIT((R x V) x XSMD), YSMD = UNIT(ZSMD x XSMD)). X x Y = X x (Z x X) = Z, so the triad is right-handed.",
};

/**
 * THE BOOTSTRAP.
 *
 * Reference frame := the landing-site stable-member orientation triad that
 * Luminary itself computes in P52 option 4. The scenario declares that a P52
 * option-4 alignment to that triad completed before t=0, so the stable member
 * IS that triad and REFSMMAT is the identity BY CONSTRUCTION.
 *
 * The vehicle is declared to be at zero gimbal angles, i.e. LM body axes
 * coincident with the stable-member axes. For a purely vertical descent the
 * DPS thrust axis (body +X) then points along +X_SM = local vertical up at
 * the landing site, which is precisely the geometry the M3.1 kernel models.
 */
export const LUMINARY099_FIXED_ATTITUDE_IMU_V1: FixedAttitudeImuBootstrapV1 = {
  id: "luminary099-fixed-attitude-imu-v1",
  coordinateConvention: {
    id: "landing-site-stable-member-triad-v1",
    referenceFrame: REFERENCE_FRAME,
    stableMemberFrame:
      "Identical to the reference frame by declared prior P52 option-4 alignment; X_SM = local vertical up at the landing site.",
    bodyFrame:
      "LM body axes; Luminary treats navigation-base and body axes as the same triad (POWERED_FLIGHT_SUBROUTINES.agc:307). At bootstrap all three gimbal angles are zero, so body axes == stable-member axes.",
    thrustAxisBody: [1, 0, 0],
    pipaAxisAssignment:
      "PIPAX/PIPAY/PIPAZ measure specific force along stable-member X/Y/Z. SERVICER.agc:556-568 (PIPASR) transfers the raw counters straight into DELVX/Y/Z and SERVICER.agc:186 uses DELV with no XNB rotation, so the PIPA triad IS the stable-member triad.",
  },
  refsmmat: IDENTITY_MATRIX3,
  refsmmatWords: buildRefsmmatInitializers(IDENTITY_MATRIX3),
  initialCduCounts: { x: 0, y: 0, z: 0 },
  bodyToStableMember: IDENTITY_MATRIX3,
  stableMemberSpecificForceAxis: [1, 0, 0],
  citations: [
    {
      claim: "REFSMMAT transforms REFERENCE -> STABLE MEMBER and is stored at half-unit scale.",
      source: "Luminary099/P40-P47.agc:815, :833-834; R63.agc:116-117",
    },
    {
      claim: "REFSMMAT is 9 DP elements stored ROW MAJOR (MXV consumes contiguous rows).",
      source: "Luminary099/INTERPRETER.agc:1133-1152",
    },
    {
      claim: "REFSMMAT occupies 18 erasable words at ECADR 0o1733 (EBANK 3).",
      source:
        "Luminary099/ERASABLE_ASSIGNMENTS.agc:958 resolved by yaYUL @b6d27dc to E3,1733; DOWNLINK_LISTS.agc:80",
    },
    {
      claim:
        "Landing-site IMU orientation defines X_SM = UNIT(RLS); the triad is right-handed.",
      source: "Luminary099/P51-P53.agc:248-268 (P52LS, LSORIENT)",
    },
    {
      claim:
        "P63 transforms the landing site and the LM state into stable-member coordinates through REFSMMAT before guidance initialisation.",
      source: "Luminary099/THE_LUNAR_LANDING.agc:77-120 (IGNALG/IGNALOOP)",
    },
    {
      claim:
        "The braking-phase attitude convention points LM body +X (SCAXIS = UNITX) at POINTVSM = REFSMMAT x desired thrust direction.",
      source: "Luminary099/P40-P47.agc:824-838 (S40.2,3)",
    },
    {
      claim:
        "The body -> stable-member matrix XNB is a pure function of the three CDU angles; no other state enters it.",
      source: "Luminary099/POWERED_FLIGHT_SUBROUTINES.agc:307-345 (FLESHPOT)",
    },
    {
      claim:
        "CDU counters are read, not drained, at PIPA time — a static attitude requires no CDU pulses.",
      source: "Luminary099/SERVICER.agc:570-581 (PIPASR)",
    },
    {
      claim:
        "CDU counter words are 15-bit two's complement scaled at half a revolution; zero counts == zero gimbal angle; the counter wraps over a full revolution.",
      source:
        "Luminary099/POWERED_FLIGHT_SUBROUTINES.agc:77-84 (CDUTRIGS) -> INTERPRETER.agc CDULOGIC header; ERASABLE_ASSIGNMENTS.agc:1927-1929",
    },
    {
      claim:
        "REFSMFLG (FLAGWRD3 bit 13) declares the IMU orientation known and is explicitly protected from fresh start.",
      source:
        "Luminary099/FLAGWORD_ASSIGNMENTS.agc:454, :467-468; FRESH_START_AND_RESTART.agc:152",
    },
  ],
  limitations: [
    "SOURCE-DERIVED SYNTHETIC SCENARIO COORDINATE ALIGNMENT. Represents a valid prior IMU alignment. NOT the historical Apollo 11 flown REFSMMAT or pad load.",
    "Valid only while the scenario attitude is fixed. Any commanded or simulated attitude change invalidates it, because the CDU counters would then have to be driven and the live CDU pulse weight and drain budget are still unproven.",
    "Covers REFSMMAT, the three CDU counters and REFSMFLG only. It does not establish RLS, TLAND, the LM state vector, or any other P63 prerequisite.",
    "Not yet installed into a rope: HW-I/O v3 exposes no erasable-write path and no uplink/pad-load path (see BOOTSTRAP_INSTALLATION_BLOCKER).",
  ],
  requiredForProfiles: ["descent-monitor-v1"],
};

function buildRefsmmatInitializers(m: Matrix3): readonly SourceMappedInitializer[] {
  const words = refsmmatToWords(m);
  const labels = ["11", "12", "13", "21", "22", "23", "31", "32", "33"];
  return words.map((rawWord, i) => {
    const element = labels[i >> 1];
    const part = i % 2 === 0 ? "hi" : "lo";
    const address = REFSMMAT_ECADR + i;
    return {
      symbol: `REFSMMAT +${i} (M${element} ${part})`,
      address,
      rawWord,
      decodedValue: `${m[i >> 1]} (pure element M${element})`,
      scale: "B-1 half-unit (Luminary099/P40-P47.agc:815 'SCALED AT 2')",
      sourceCitation:
        "Luminary099/ERASABLE_ASSIGNMENTS.agc:958 (ECADR 0o1733, 18 words, row-major per INTERPRETER.agc:1140)",
      priorStateReason:
        "Written by a P52 option-4 (landing-site) IMU alignment declared complete before scenario t=0.",
      applyOrder: i,
    } satisfies SourceMappedInitializer;
  });
}

/** The CDU and flagword initializers, ordered after the matrix words. */
export const FIXED_ATTITUDE_STATE_INITIALIZERS: readonly SourceMappedInitializer[] = [
  {
    symbol: "CDUX",
    address: CDUX_ADDRESS,
    rawWord: 0,
    decodedValue: "0.000 deg outer gimbal angle",
    scale: "15-bit two's complement, 180 deg full scale (0.010986 deg/count)",
    sourceCitation:
      "Luminary099/ERASABLE_ASSIGNMENTS.agc:117; POWERED_FLIGHT_SUBROUTINES.agc:77; INTERPRETER.agc CDULOGIC",
    priorStateReason:
      "Vehicle attitude is fixed with body axes coincident with the stable member; the CDU counter tracks the gimbal and has not moved since alignment.",
    applyOrder: 18,
  },
  {
    symbol: "CDUY",
    address: CDUY_ADDRESS,
    rawWord: 0,
    decodedValue: "0.000 deg inner gimbal angle",
    scale: "15-bit two's complement, 180 deg full scale",
    sourceCitation: "Luminary099/ERASABLE_ASSIGNMENTS.agc:118",
    priorStateReason: "As CDUX.",
    applyOrder: 19,
  },
  {
    symbol: "CDUZ",
    address: CDUZ_ADDRESS,
    rawWord: 0,
    decodedValue: "0.000 deg middle gimbal angle",
    scale: "15-bit two's complement, 180 deg full scale",
    sourceCitation: "Luminary099/ERASABLE_ASSIGNMENTS.agc:119",
    priorStateReason: "As CDUX.",
    applyOrder: 20,
  },
  {
    symbol: "FLAGWRD3 (REFSMFLG set)",
    address: FLAGWRD3_ADDRESS,
    rawWord: REFSMFLG_MASK,
    decodedValue: "REFSMFLG SET — 'REFSMMAT GOOD'",
    scale: "flag bit (BIT13)",
    sourceCitation:
      "Luminary099/FLAGWORD_ASSIGNMENTS.agc:454, :467-468; FRESH_START_AND_RESTART.agc:152 'DO NOT ALTER REFSMFLG ON FRESH START'",
    priorStateReason:
      "Set by the completed prior alignment; Luminary explicitly preserves it across fresh start.",
    applyOrder: 21,
  },
];

/**
 * The remaining blocker between this proven definition and a live rope.
 *
 * HW-I/O v3 exposes `get_erasable_ptr()` for READING erasable memory and the
 * ordered counter-input API for PINC/MINC, but there is no host write path,
 * and no source-legitimate uplink (P27 / V71-V72) path is implemented. A
 * bootstrap that cannot be installed cannot be verified at rope level, so no
 * production monitor profile may rely on it yet.
 */
export const BOOTSTRAP_INSTALLATION_BLOCKER =
  "imu-bootstrap-installation-path-unresolved" as const;

// ---------------------------------------------------------------------------
// Validation — the gate an activation path must call
// ---------------------------------------------------------------------------

export interface BootstrapValidationError {
  readonly kind:
    | "matrix-not-orthonormal"
    | "matrix-determinant"
    | "word-roundtrip"
    | "cdu-out-of-range"
    | "cdu-disagrees-with-body-matrix"
    | "thrust-axis-mismatch"
    | "initializer-order"
    | "missing-citation";
  readonly message: string;
}

export function validateFixedAttitudeBootstrap(
  b: FixedAttitudeImuBootstrapV1 = LUMINARY099_FIXED_ATTITUDE_IMU_V1,
  tol = 1e-9,
): readonly BootstrapValidationError[] {
  const errors: BootstrapValidationError[] = [];

  for (const [name, m] of [
    ["refsmmat", b.refsmmat] as const,
    ["bodyToStableMember", b.bodyToStableMember] as const,
  ]) {
    if (orthonormalityDefect(m) > tol) {
      errors.push({
        kind: "matrix-not-orthonormal",
        message: `${name} is not orthonormal (defect ${orthonormalityDefect(m)})`,
      });
    }
    if (Math.abs(determinant(m) - 1) > tol) {
      errors.push({
        kind: "matrix-determinant",
        message: `${name} determinant is ${determinant(m)}, expected +1`,
      });
    }
  }

  // Word round-trip: the declared initializers must decode back to refsmmat.
  const words = b.refsmmatWords.map((w) => w.rawWord);
  if (words.length !== REFSMMAT_WORD_COUNT) {
    errors.push({
      kind: "word-roundtrip",
      message: `expected ${REFSMMAT_WORD_COUNT} REFSMMAT words, got ${words.length}`,
    });
  } else {
    const decoded = wordsToRefsmmat(words);
    for (let i = 0; i < 9; i++) {
      if (Math.abs(decoded[i] - b.refsmmat[i]) > 1e-8) {
        errors.push({
          kind: "word-roundtrip",
          message: `REFSMMAT element ${i} decodes to ${decoded[i]}, expected ${b.refsmmat[i]}`,
        });
      }
    }
  }

  // CDU counts must be legal and must reproduce the declared body matrix.
  const { x, y, z } = b.initialCduCounts;
  for (const [n, v] of [["x", x], ["y", y], ["z", z]] as const) {
    if (!Number.isInteger(v) || v < 0 || v >= CDU_COUNTS_PER_REVOLUTION) {
      errors.push({
        kind: "cdu-out-of-range",
        message: `CDU${n.toUpperCase()} count ${v} is not a legal 15-bit counter value`,
      });
    }
  }
  const xnb = xnbFromCduDegrees(
    cduCountsToDegrees(x),
    cduCountsToDegrees(y),
    cduCountsToDegrees(z),
  );
  for (let i = 0; i < 9; i++) {
    if (Math.abs(xnb[i] - b.bodyToStableMember[i]) > 1e-9) {
      errors.push({
        kind: "cdu-disagrees-with-body-matrix",
        message: `element ${i}: CDU counts imply ${xnb[i]}, bootstrap declares ${b.bodyToStableMember[i]}`,
      });
      break;
    }
  }

  // The declared PIPA-axis specific-force direction must equal XNB * body +X.
  const expected = matVec(b.bodyToStableMember, b.coordinateConvention.thrustAxisBody);
  for (let i = 0; i < 3; i++) {
    if (Math.abs(expected[i] - b.stableMemberSpecificForceAxis[i]) > 1e-9) {
      errors.push({
        kind: "thrust-axis-mismatch",
        message: `stable-member thrust axis component ${i}: expected ${expected[i]}, declared ${b.stableMemberSpecificForceAxis[i]}`,
      });
      break;
    }
  }

  b.refsmmatWords.forEach((w, i) => {
    if (w.applyOrder !== i) {
      errors.push({
        kind: "initializer-order",
        message: `initializer ${w.symbol} has applyOrder ${w.applyOrder}, expected ${i}`,
      });
    }
    if (!w.sourceCitation) {
      errors.push({ kind: "missing-citation", message: `${w.symbol} has no citation` });
    }
  });

  return errors;
}

/**
 * Map a BODY-axis specific force (m/s^2) into stable-member axes using the
 * bootstrap's proven body->SM matrix. This is the only sanctioned way for a
 * scenario to obtain the vector `encodePipaTick` consumes.
 */
export function stableMemberSpecificForceFromBody(
  bodySpecificForce: Vec3,
  bootstrap: FixedAttitudeImuBootstrapV1 = LUMINARY099_FIXED_ATTITUDE_IMU_V1,
): Vec3 {
  return matVec(bootstrap.bodyToStableMember, bodySpecificForce);
}
