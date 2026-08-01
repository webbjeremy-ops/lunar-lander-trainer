import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AgcSessionProvider } from "@/agc/AgcSession";
import { SettingsProvider } from "@/settings/SettingsProvider";
import { AppNav } from "@/ui/shell/AppNav";
import { AppFooter } from "@/ui/shell/AppFooter";
import { AgcBootBanner, RecoverableError } from "@/ui/shell/Reliability";



function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4">
      <div className="w-full max-w-md">
        <RecoverableError
          title="This page didn't load"
          detail={error.message}
          onRetry={() => {
            router.invalidate();
            reset();
          }}
          testId="route-error"
        />
        <p className="mt-3 text-center text-xs text-neutral-500">
          Nothing was lost — your progress and settings live in this browser and are untouched.
        </p>
      </div>
    </div>
  );
}


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Tranquility — Learn the AGC, fly a lunar landing" },
      {
        name: "description",
        content:
          "Learn the Apollo Guidance Computer, fly a lunar landing, and launch back into lunar orbit. Free, browser-based, running the real Luminary 099 flight software.",
      },
      { name: "author", content: "The Tranquility project" },
      { property: "og:site_name", content: "Tranquility" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:title", content: "Tranquility — Learn the AGC, fly a lunar landing" },
      { name: "twitter:title", content: "Tranquility — Learn the AGC, fly a lunar landing" },
      { property: "og:description", content: "Learn the Apollo Guidance Computer, fly a lunar landing, and launch back into lunar orbit. Free, browser-based, running the real Luminary 099 flight software." },
      { name: "twitter:description", content: "Learn the Apollo Guidance Computer, fly a lunar landing, and launch back into lunar orbit. Free, browser-based, running the real Luminary 099 flight software." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/267ce5b3-3f04-4a90-8d08-80ec7ba27aa2/id-preview-94e1cd1c--7a1f4da4-ee84-4871-851a-9e77c762e890.lovable.app-1785611256132.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/267ce5b3-3f04-4a90-8d08-80ec7ba27aa2/id-preview-94e1cd1c--7a1f4da4-ee84-4871-851a-9e77c762e890.lovable.app-1785611256132.png" },
    ],

    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Shared AGC Worker session — one emulator instance persists across
          route changes (/learn ↔ /explore). See src/agc/AgcSession.tsx. */}
      <AgcSessionProvider>
        <SettingsProvider>
          <a
            href="#main-content"
            className="sr-only rounded bg-emerald-500 px-3 py-2 font-mono text-xs uppercase tracking-widest text-neutral-950 focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50"
          >
            Skip to content
          </a>
          <AppNav />
          <AgcBootBanner />
          <div id="main-content">
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </div>
          <AppFooter />
        </SettingsProvider>

      </AgcSessionProvider>
    </QueryClientProvider>
  );
}

