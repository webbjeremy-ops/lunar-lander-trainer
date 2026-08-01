# First-Person Commander's Window View

Add a toggleable first-person view from the left (commander's) window — the one Neil Armstrong looked through — showing the lunar surface sliding past, landmarks, the LPD reticle, and the LM's own shadow rising into frame as the vehicle settles onto the surface.

## When it's available

- The toggle appears only after P64 is selected (vehicle pitching upright) — before that the windows face space/straight down and there is nothing to see.
- Default stays on the current profile/out-the-window scene; the player switches with an on-screen button (and a keyboard key). The existing scene stays untouched and is still one click away.
- Missions that start already upright (Landing Fundamentals) get the toggle from the start.

## What the window shows

A deterministic canvas painting, drawn from existing flight state (altitude, downrange-to-go, pitch, roll, horizontal and vertical speed) — no new physics, no 3D engine:

- **Window frame**: the trapezoidal commander's window with its bevelled inner sill and rivet line, plus a slice of the adjacent instrument panel edge, matching the reference photo's off-axis framing.
- **Surface**: grey regolith plane in perspective, horizon curvature that flattens as altitude drops, sun low from the left with long shadows.
- **Landmarks**: a fixed, seeded set of craters and boulder fields placed along the descent ground track at known ranges, so they enter the top of the window and sweep toward and past the bottom at the correct rate for the current ground speed. Same landmarks every run for a given mission (deterministic seed).
- **LPD reticle**: the etched landing-point-designator scale on the glass with its numbered angle marks, and the LPD sight line at the current guidance look angle.
- **Landing zone**: the target site marked on the surface, sized and positioned from range-to-go so it grows and drifts as the vehicle closes.
- **LM shadow**: below roughly 150 ft the lander's shadow appears out on the surface ahead-left of the shadow-sun line and swells toward the vehicle, meeting it at touchdown — the visual cue crews used for the final feet.
- **Dust**: streaming radial dust below about 100 ft, thickening toward contact, obscuring the near surface as it did on the real landing.
- **Readouts**: minimal etched-style overlay (altitude, descent rate, forward/lateral velocity) so the view is flyable without switching back.

## Technical notes

- New `src/ui/play/CockpitWindowView.tsx`: a canvas component with the same render pattern as `LunarScene` — props into a ref, one paint per animation frame, pure drawing, no state mutation.
- New `src/game/play/windowLandmarks.ts`: pure, seeded landmark table plus the projection helpers (surface point at a given range/offset -> screen point for the current altitude and pitch) and the shadow/dust envelope functions. Unit-tested for determinism and for shadow onset/growth against altitude.
- `src/routes/play.tsx` holds the view-mode state, renders the toggle, and swaps `LunarScene` for `CockpitWindowView`; visibility of the toggle keys off the same `p64Selected` expression already computed there.
- Colours come from the existing LM cockpit tokens in `src/styles.css`; no hardcoded colour utilities.
- Tests: landmark determinism, shadow appearance threshold and growth, projection sanity (landmarks move down-frame as range closes), and a Playwright check that the toggle appears post-P64 and renders the window canvas.
