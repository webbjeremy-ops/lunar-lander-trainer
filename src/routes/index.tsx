import { createFileRoute, Link } from "@tanstack/react-router";
import { AccuracyLegend } from "@/ui/shell/AccuracyLegend";
import { OnboardingFlow } from "@/ui/shell/Onboarding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tranquility — Learn the AGC, fly a lunar landing" },
      {
        name: "description",
        content:
          "Learn the Apollo Guidance Computer, fly a lunar landing, and launch back into lunar orbit. Free, browser-based, running the real Luminary 099 flight software.",
      },
      { property: "og:title", content: "Tranquility — Apollo lunar flight, honestly modelled" },
      {
        property: "og:description",
        content:
          "Fly the lunar descent, launch from the Moon, learn rocket physics, and operate a real Apollo DSKY in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

interface Pillar {
  readonly to: string;
  readonly title: string;
  readonly body: string;
  readonly testId: string;
  readonly cta: string;
}

const PILLARS: readonly Pillar[] = [
  {
    to: "/play",
    title: "Fly the Lunar Descent",
    body: "Powered descent from orbit to the surface: braking, high gate, low gate and the final hover, with landing limits that tighten as you level up.",
    cta: "Open the descent cockpit",
    testId: "pillar-descent",
  },
  {
    to: "/play/ascent",
    title: "Launch from the Moon",
    body: "Stage off the descent stage, hold the vertical rise, pitch over, and cut off into a real elliptical lunar orbit — with apsis markers and a live coast arc.",
    cta: "Open the ascent cockpit",
    testId: "pillar-ascent",
  },
  {
    to: "/learn",
    title: "Learn Rocket Physics",
    body: "Sixteen lessons across four tracks: why the lander falls, thrust-to-weight, the rocket equation, and why an orbit is just continuous free fall.",
    cta: "Start the learning tracks",
    testId: "pillar-learn",
  },
  {
    to: "/sim",
    title: "Operate the DSKY",
    body: "The AGC Lab: a full-size Apollo display and keyboard driven by the real I/O channels. Type V35E and watch the actual rope light the lamps.",
    cta: "Open the AGC Lab",
    testId: "pillar-dsky",
  },
  {
    to: "/explore",
    title: "Explore the Live AGC",
    body: "Read-only telemetry from the running computer: channel words, erasable memory, a deterministic event log, and replay you can scrub.",
    cta: "Inspect the running computer",
    testId: "pillar-explore",
  },
];

function Landing() {
  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-100">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-400">
            Tranquility
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Learn the Apollo Guidance Computer, fly a lunar landing, and launch back into lunar
            orbit.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-neutral-400">
            Tranquility is a free, open-source Apollo flight simulator that runs entirely in your
            browser. The Apollo Guidance Computer is not a mock-up: the unmodified Luminary 099
            rope executes on a WebAssembly build of yaAGC and drives an authentic DSKY. The flight
            model around it is a deterministic, deliberately readable planar simulation, and every
            screen tells you which is which.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              to="/missions"
              data-testid="home-cta-missions"
              className="rounded border border-emerald-500 bg-emerald-950/40 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              Choose a mission →
            </Link>
            <Link
              to="/learn"
              data-testid="home-cta-learn"
              className="rounded border border-neutral-700 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-neutral-300 hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            >
              Start learning
            </Link>
          </div>
        </header>

        <OnboardingFlow />

        <section aria-labelledby="pillars-heading">
          <h2
            id="pillars-heading"
            className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-400"
          >
            What you can do
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p) => (
              <li key={p.to}>
                <Link
                  to={p.to}
                  data-testid={p.testId}
                  className="block h-full rounded border border-neutral-800 bg-neutral-950/60 p-4 transition-colors hover:border-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  <h3 className="text-sm font-semibold text-neutral-100">{p.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-neutral-400">{p.body}</p>
                  <span className="mt-3 block font-mono text-[10px] uppercase tracking-widest text-emerald-400">
                    {p.cta} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="fidelity-heading"
          className="rounded border border-neutral-800 bg-neutral-950/60 p-4"
        >
          <h2
            id="fidelity-heading"
            className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-400"
          >
            How historically accurate is this?
          </h2>
          <div className="mt-2 space-y-3 text-xs leading-relaxed text-neutral-400">
            <p>
              The computer is real. Luminary 099 is assembled from the public-domain NASA source
              and executed instruction-by-instruction; the DSKY you type on is wired to channels
              010, 011, 013 and 0163 exactly as the hardware was. Nothing on that display is
              animated or faked.
            </p>
            <p>
              The spacecraft around it is not the real thing, and we never claim it is. Flight
              dynamics use a deterministic Moon-centred planar model with inverse-square gravity,
              variable mass, and separate descent and ascent engine models. Masses, thrusts and
              specific impulses come from NASA documents; trajectories are reconstructions anchored
              to documented landmarks such as high gate, low gate and the 9 × 45 nmi insertion
              orbit.
            </p>
            <p>
              One rule is absolute and enforced by tests:{" "}
              <strong className="text-neutral-200">
                the AGC never commands the vehicle and the vehicle never writes to the AGC
              </strong>
              . Closed-loop AGC control is deliberately out of scope, so the emulator stays an
              honest exhibit rather than a hidden autopilot.
            </p>
            <p>
              Full attribution, rope hashes and reproduction status live on the{" "}
              <Link className="text-emerald-400 underline underline-offset-2" to="/sources">
                Sources &amp; methodology
              </Link>{" "}
              page. Not endorsed by NASA.
            </p>
          </div>
        </section>

        <AccuracyLegend />
      </div>
    </main>
  );
}
