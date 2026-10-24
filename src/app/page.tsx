import { Suspense } from "react";
import { App } from "@/components/App";
import { Intro } from "@/components/Intro";

/** The app reads the URL, so it renders on the client; the title block is in the server HTML meanwhile. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
          <Intro>
            <p className="mt-2 text-meta text-muted">Loading the demo…</p>
          </Intro>
        </main>
      }
    >
      <App />
    </Suspense>
  );
}
