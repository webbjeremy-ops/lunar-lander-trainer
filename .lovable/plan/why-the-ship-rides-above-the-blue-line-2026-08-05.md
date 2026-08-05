# Why the ship rides above the blue line

The blue dotted line is not drawn from the mission's own descent table. The profile inset builds its own throwaway curve from four hand-typed knots (`referenceAltitudeM` in `src/ui/play/LunarScene.tsx`), while the vehicle is flown against the as-flown milestone table in `src/game/play/descentTimeline.ts`.

The two disagree, and they disagree in the direction you're seeing:

- Reference curve knots: 2,316 m altitude at 8,300 m range-to-go, then straight to 152 m at 600 m.
- As-flown table: high gate 7,129 ft (2,173 m) at 4.1 nmi (7,593 m), low gate 500 ft at 0.3 nmi (556 m), plus every intermediate milestone.

Between those knots the reference line is a straight chord, whereas the real profile is a shallow, drooping arc that stays high and then steepens near low gate. A chord drawn under an arc sits below it nearly everywhere — hence "above the blue line most of the way." It is a drawing artifact, not a trajectory error.

## Fix

Delete the ad-hoc knot list and have the inset sample the same source of truth the vehicle flies.

1. In `src/ui/play/LunarScene.tsx`, remove `referenceAltitudeM` and import `nominalAltitudeForRangeM` from `src/game/play/descentTimeline.ts`.
2. Sample that function across the visible range span when stroking the dotted blue polyline, so the curve passes exactly through PDI, high gate, low gate and touchdown.
3. Above the table's first entry (before PDI, during coast) hold the first milestone's altitude rather than extrapolating, so the line doesn't shoot off the top of the inset.
4. Update the "vs profile" deviation readout in the header to use the same function, so the number and the picture agree.

## Expected result

The flown green trail tracks the blue dotted line closely through P63 and P64, with deviation reading near zero under auto-guidance and only departing once the commander takes manual control at P66.

## Technical notes

- `nominalAltitudeForRangeM` already does piecewise-linear interpolation over the milestone table and clamps at both ends, so no new interpolation code is needed.
- No change to physics, guidance, or the timeline itself — this is presentation only.
- Add a regression test asserting the drawn reference altitude at high gate and low gate range matches the milestone table values.
