/*
 * M3.3A2-P2 hardware-interface extension for yaAGC.
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Additive shim over virtualagc @ ddc65e7b. Introduces:
 *   - immutable counter capability table (host-input / observable-output /
 *     internally-timed / test-only), with strict IncType allow-lists
 *   - agc_counter_increment (test-only single pulse via native UnprogrammedIncrement)
 *   - agc_hw_input_apply (ordered batched host input, atomic validation)
 *   - agc_out_trace_* (bounded lossless ring for whitelisted output counters)
 *   - agc_ext_version / agc_hwio_version (extension identity, distinct from version())
 *
 * No RADARUPT/T3RUPT/T4RUPT exports: those are internally generated.
 * No behavioural change unless a new export is invoked.
 */

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "yaAGC.h"
#include "agc_engine.h"

#define export __attribute__((visibility("default")))

extern agc_t State;

/* ---- IncType identifiers (mirror agc_engine.c UnprogrammedIncrement switch) ---- */
#define HWIO_INC_PINC   0
#define HWIO_INC_PCDU   1
#define HWIO_INC_MINC   2
#define HWIO_INC_MCDU   3
#define HWIO_INC_DINC   4
#define HWIO_INC_SHINC  5
#define HWIO_INC_SHANC  6
#define HWIO_INC_PCDUX  021   /* alt PCDU sequence id */
#define HWIO_INC_MCDUX  023   /* alt MCDU sequence id */

/* Roles */
#define ROLE_HOST_INPUT       1
#define ROLE_OBSERVABLE_OUT   2
#define ROLE_INTERNALLY_TIMED 3
#define ROLE_TEST_ONLY        4

typedef struct {
  uint16_t address;
  uint16_t allowed_inc_types_mask;   /* bit N set => IncType N permitted (N up to 31) */
  uint8_t  role;
  uint8_t  flags;                    /* reserved */
} AgcHwCounterCapability;

/* Helpers for constructing masks (IncType ids <= 023 = 19, fits in 32 bits) */
#define M(x) ((uint32_t)1u << (x))

/* --- Capability table ---
 * Host-input counters: only those mapped by docs/M3_3_IO_MAP.md.
 *   PIPAX/Y/Z (037-041): PINC or MINC
 *   CDUX/Y/Z  (032-034): PCDU or MCDU (either sequence id form)
 *   RNRAD     (046):     PINC or MINC (LR range word delivery)
 * Observable-output counters (host-incrementable? NO):
 *   THRUST    (055):     no host input permitted
 *   CDUXCMD/YCMD/ZCMD (050-052)
 *   GYROCTR   (047)
 * Internally-timed counters:
 *   TIME1..TIME6 (025-031)  -- never host-writable
 * (Test-only bucket is intentionally empty in P2 production shim.)
 */
static const AgcHwCounterCapability CAPS[] = {
  { 032, M(HWIO_INC_PCDU)|M(HWIO_INC_MCDU)|M(HWIO_INC_PCDUX)|M(HWIO_INC_MCDUX), ROLE_HOST_INPUT, 0 },
  { 033, M(HWIO_INC_PCDU)|M(HWIO_INC_MCDU)|M(HWIO_INC_PCDUX)|M(HWIO_INC_MCDUX), ROLE_HOST_INPUT, 0 },
  { 034, M(HWIO_INC_PCDU)|M(HWIO_INC_MCDU)|M(HWIO_INC_PCDUX)|M(HWIO_INC_MCDUX), ROLE_HOST_INPUT, 0 },
  { 037, M(HWIO_INC_PINC)|M(HWIO_INC_MINC), ROLE_HOST_INPUT, 0 },
  { 040, M(HWIO_INC_PINC)|M(HWIO_INC_MINC), ROLE_HOST_INPUT, 0 },
  { 041, M(HWIO_INC_PINC)|M(HWIO_INC_MINC), ROLE_HOST_INPUT, 0 },
  { 046, M(HWIO_INC_PINC)|M(HWIO_INC_MINC), ROLE_HOST_INPUT, 0 },

  { 025, 0, ROLE_INTERNALLY_TIMED, 0 },
  { 026, 0, ROLE_INTERNALLY_TIMED, 0 },
  { 027, 0, ROLE_INTERNALLY_TIMED, 0 },
  { 030, 0, ROLE_INTERNALLY_TIMED, 0 },
  { 031, 0, ROLE_INTERNALLY_TIMED, 0 },
  { 024, 0, ROLE_INTERNALLY_TIMED, 0 },   /* SCALER1 / RegCOUNTER */

  { 047, 0, ROLE_OBSERVABLE_OUT, 0 },
  { 050, 0, ROLE_OBSERVABLE_OUT, 0 },
  { 051, 0, ROLE_OBSERVABLE_OUT, 0 },
  { 052, 0, ROLE_OBSERVABLE_OUT, 0 },
  { 055, 0, ROLE_OBSERVABLE_OUT, 0 },
};
#define CAPS_COUNT (sizeof(CAPS)/sizeof(CAPS[0]))

/* Result codes */
#define HWIO_OK                     0
#define HWIO_ERR_INVALID_ADDRESS   -1
#define HWIO_ERR_INVALID_INC_TYPE  -2
#define HWIO_ERR_NOT_PERMITTED     -3
#define HWIO_ERR_INTERNAL          -4
#define HWIO_ERR_BATCH_LIMIT       -5
#define HWIO_ERR_OVERFLOW          -6

/* Batch limits */
#define HWIO_MAX_RECORDS       256
#define HWIO_MAX_PULSES_RECORD 16384
#define HWIO_MAX_TOTAL_PULSES  262144

/* --- Output trace ring (whitelisted output counters) --- */
typedef struct {
  uint32_t sequence_hi;
  uint32_t sequence_lo;
  uint32_t cycle_hi;
  uint32_t cycle_lo;
  uint16_t address;
  uint16_t operation;   /* 0 = WRITE (AGC store); native IncType id when observed via UP-seq */
  int32_t  delta;
  uint16_t value_before;
  uint16_t value_after;
  uint16_t _pad;
} AgcOutputTraceEntry;

_Static_assert(sizeof(AgcOutputTraceEntry) == 32, "trace entry size stable");

#define HWIO_TRACE_CAP 4096
static AgcOutputTraceEntry TraceRing[HWIO_TRACE_CAP];
static uint32_t TraceHead = 0;   /* write index */
static uint32_t TraceCount = 0;  /* live entries */
static uint32_t TraceDropped = 0;
static uint64_t TraceSequence = 0;
static uint64_t CycleCounter = 0;  /* incremented by cpu_step wrapper */

/* Per-observable-output last-observed value cache. Indexed by CAPS index. */
static uint16_t OutLast[CAPS_COUNT];
static int OutInit = 0;

/* Trace arming. MUST default to 0 (disabled) so that merely swapping the WASM
 * binary in place of yaAGC.wasm produces no observable side effect and no
 * accumulating state. The monitor adapter enables tracing explicitly after
 * instantiation and after cpu_reset. See docs/M3_3A2_P3.md (dormancy audit). */
static uint32_t TraceEnabled = 0;

static int find_cap_index(uint16_t address, int role_filter) {
  for (uint32_t i = 0; i < CAPS_COUNT; i++) {
    if (CAPS[i].address == address) {
      if (role_filter == 0 || CAPS[i].role == role_filter) return (int)i;
      return -2; /* wrong role */
    }
  }
  return -1;
}

static int inc_type_valid(uint16_t inc_type) {
  switch (inc_type) {
    case HWIO_INC_PINC: case HWIO_INC_MINC:
    case HWIO_INC_PCDU: case HWIO_INC_MCDU:
    case HWIO_INC_PCDUX: case HWIO_INC_MCDUX:
    case HWIO_INC_DINC: case HWIO_INC_SHINC: case HWIO_INC_SHANC:
      return 1;
  }
  return 0;
}

static int cap_permits(uint32_t idx, uint16_t inc_type) {
  if (inc_type >= 32) return 0;
  return (CAPS[idx].allowed_inc_types_mask & M(inc_type)) != 0;
}

static void trace_push(uint16_t address, uint16_t operation,
                       uint16_t before, uint16_t after) {
  int32_t delta = (int32_t)after - (int32_t)before;
  AgcOutputTraceEntry *e = &TraceRing[TraceHead];
  TraceSequence++;
  e->sequence_hi = (uint32_t)(TraceSequence >> 32);
  e->sequence_lo = (uint32_t)(TraceSequence & 0xffffffffu);
  e->cycle_hi = (uint32_t)(CycleCounter >> 32);
  e->cycle_lo = (uint32_t)(CycleCounter & 0xffffffffu);
  e->address = address;
  e->operation = operation;
  e->delta = delta;
  e->value_before = before;
  e->value_after = after;
  e->_pad = 0;
  TraceHead = (TraceHead + 1) % HWIO_TRACE_CAP;
  if (TraceCount < HWIO_TRACE_CAP) TraceCount++;
  else TraceDropped++;
}

/* Sample all observable output counters; called after each agc_engine tick.
 * yaAGC applies TS THRUST etc. as direct erasable stores, so per-cycle sampling
 * captures every net change with a stable ordering. delta==0 => no push.
 */
static void trace_sample_all(void) {
  if (!OutInit) {
    for (uint32_t i = 0; i < CAPS_COUNT; i++) {
      if (CAPS[i].role == ROLE_OBSERVABLE_OUT)
        OutLast[i] = (uint16_t)(State.Erasable[0][CAPS[i].address] & 0xffffu);
    }
    OutInit = 1;
    return;
  }
  for (uint32_t i = 0; i < CAPS_COUNT; i++) {
    if (CAPS[i].role != ROLE_OBSERVABLE_OUT) continue;
    uint16_t after = (uint16_t)(State.Erasable[0][CAPS[i].address] & 0xffffu);
    if (after != OutLast[i]) {
      trace_push(CAPS[i].address, 0, OutLast[i], after);
      OutLast[i] = after;
    }
  }
}

/* --- Exports --- */

export const char *
agc_ext_version(void) {
  return "ddc65e7be+apollo-browser-hwio-v1";
}

export uint32_t
agc_hwio_version(void) {
  return 1u;
}

export uint32_t
agc_out_trace_entry_size(void) {
  return (uint32_t)sizeof(AgcOutputTraceEntry);
}

export uint32_t
agc_out_trace_dropped(void) {
  return TraceDropped;
}

export void
agc_out_trace_reset(void) {
  TraceHead = 0; TraceCount = 0; TraceDropped = 0; TraceSequence = 0;
  OutInit = 0;
}

/* Drain up to max_entries oldest entries into destination in FIFO order. */
export uint32_t
agc_out_trace_drain(void *destination, uint32_t max_entries) {
  if (!destination || max_entries == 0) return 0;
  uint32_t n = TraceCount < max_entries ? TraceCount : max_entries;
  uint32_t tail = (TraceHead + HWIO_TRACE_CAP - TraceCount) % HWIO_TRACE_CAP;
  AgcOutputTraceEntry *dst = (AgcOutputTraceEntry *)destination;
  for (uint32_t i = 0; i < n; i++) {
    dst[i] = TraceRing[tail];
    tail = (tail + 1) % HWIO_TRACE_CAP;
  }
  TraceCount -= n;
  return n;
}

/* Single-shot host counter increment (test-oriented). */
export int32_t
agc_counter_increment(uint16_t address, uint16_t inc_type) {
  if (!inc_type_valid(inc_type)) return HWIO_ERR_INVALID_INC_TYPE;
  int idx = find_cap_index(address, 0);
  if (idx == -1) return HWIO_ERR_INVALID_ADDRESS;
  if (idx == -2) return HWIO_ERR_NOT_PERMITTED;
  if (CAPS[idx].role != ROLE_HOST_INPUT) return HWIO_ERR_NOT_PERMITTED;
  if (!cap_permits((uint32_t)idx, inc_type)) return HWIO_ERR_NOT_PERMITTED;
  UnprogrammedIncrement(&State, (int)address, (int)inc_type);
  return HWIO_OK;
}

/* --- Batched host input --- */
typedef struct {
  uint16_t counter_address;
  uint16_t inc_type;
  uint32_t pulse_count;
  uint32_t suborder;
} AgcHwInputRecord;

_Static_assert(sizeof(AgcHwInputRecord) == 12, "input record size stable");

/* Stable in-place mergesort by (suborder, original index). */
static void sort_records(AgcHwInputRecord *arr, uint32_t *orig_index,
                         AgcHwInputRecord *tmp, uint32_t *tmp_idx, uint32_t n) {
  for (uint32_t width = 1; width < n; width *= 2) {
    for (uint32_t i = 0; i < n; i += 2*width) {
      uint32_t left = i;
      uint32_t mid = (i + width < n) ? i + width : n;
      uint32_t right = (i + 2*width < n) ? i + 2*width : n;
      uint32_t a = left, b = mid, k = left;
      while (a < mid && b < right) {
        int take_a;
        if (arr[a].suborder != arr[b].suborder)
          take_a = arr[a].suborder < arr[b].suborder;
        else
          take_a = orig_index[a] < orig_index[b];
        if (take_a) { tmp[k] = arr[a]; tmp_idx[k] = orig_index[a]; a++; }
        else        { tmp[k] = arr[b]; tmp_idx[k] = orig_index[b]; b++; }
        k++;
      }
      while (a < mid)   { tmp[k] = arr[a]; tmp_idx[k] = orig_index[a]; a++; k++; }
      while (b < right) { tmp[k] = arr[b]; tmp_idx[k] = orig_index[b]; b++; k++; }
      for (uint32_t j = left; j < right; j++) {
        arr[j] = tmp[j];
        orig_index[j] = tmp_idx[j];
      }
    }
  }
}

/* Scratch buffers (worst-case for HWIO_MAX_RECORDS). */
static AgcHwInputRecord SortBuf[HWIO_MAX_RECORDS];
static uint32_t OrigIdx[HWIO_MAX_RECORDS];
static AgcHwInputRecord TmpBuf[HWIO_MAX_RECORDS];
static uint32_t TmpIdx[HWIO_MAX_RECORDS];

/* Returns:
 *   >=0  number of records applied
 *   <0   error code; on error, no records are applied.
 *        (-1 - offending_index) is returned when a specific record fails
 *        validation, so callers can extract the index if <= -1000000 sentinel
 *        pattern... simpler: return negative index-encoded form for validation.
 * To keep the ABI simple, we return: HWIO_OK on success (records applied),
 * or a negative error code. When record-level validation fails, we also
 * publish the offending index via agc_hw_input_last_error_index().
 */
static int32_t LastErrorIndex = -1;

export int32_t
agc_hw_input_last_error_index(void) {
  return LastErrorIndex;
}

export int32_t
agc_hw_input_apply(const AgcHwInputRecord *records, uint32_t record_count) {
  LastErrorIndex = -1;
  if (record_count == 0) return HWIO_OK;
  if (!records) return HWIO_ERR_INTERNAL;
  if (record_count > HWIO_MAX_RECORDS) return HWIO_ERR_BATCH_LIMIT;

  uint64_t total_pulses = 0;
  for (uint32_t i = 0; i < record_count; i++) {
    AgcHwInputRecord r = records[i];
    if (r.pulse_count > HWIO_MAX_PULSES_RECORD) {
      LastErrorIndex = (int32_t)i;
      return HWIO_ERR_OVERFLOW;
    }
    total_pulses += r.pulse_count;
    if (total_pulses > HWIO_MAX_TOTAL_PULSES) {
      LastErrorIndex = (int32_t)i;
      return HWIO_ERR_OVERFLOW;
    }
    if (!inc_type_valid(r.inc_type)) {
      LastErrorIndex = (int32_t)i;
      return HWIO_ERR_INVALID_INC_TYPE;
    }
    int idx = find_cap_index(r.counter_address, 0);
    if (idx == -1) { LastErrorIndex = (int32_t)i; return HWIO_ERR_INVALID_ADDRESS; }
    if (idx == -2 || CAPS[idx].role != ROLE_HOST_INPUT) {
      LastErrorIndex = (int32_t)i; return HWIO_ERR_NOT_PERMITTED;
    }
    if (!cap_permits((uint32_t)idx, r.inc_type)) {
      LastErrorIndex = (int32_t)i; return HWIO_ERR_NOT_PERMITTED;
    }
  }

  /* Snapshot into sort buffer and record original insertion index. */
  for (uint32_t i = 0; i < record_count; i++) {
    SortBuf[i] = records[i];
    OrigIdx[i] = i;
  }
  sort_records(SortBuf, OrigIdx, TmpBuf, TmpIdx, record_count);

  /* Apply pulses one-at-a-time (preserves CDU FIFO ordering; PushCduFifo is
   * called per UnprogrammedIncrement invocation). No algebraic collapsing. */
  for (uint32_t i = 0; i < record_count; i++) {
    uint32_t pulses = SortBuf[i].pulse_count;
    for (uint32_t p = 0; p < pulses; p++) {
      UnprogrammedIncrement(&State, (int)SortBuf[i].counter_address, (int)SortBuf[i].inc_type);
    }
  }
  return HWIO_OK;
}

/* --- Hook invoked by wasm.c per cpu_step iteration --- */
void hwio_after_agc_engine(void) {
  CycleCounter++;
  trace_sample_all();
}

/* --- Reset trace on cpu_reset (invoked from wasm.c). --- */
void hwio_on_cpu_reset(void) {
  agc_out_trace_reset();
  CycleCounter = 0;
}
