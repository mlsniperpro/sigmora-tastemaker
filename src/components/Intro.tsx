/** The page's title block. No client state, so the server renders it before any JavaScript loads. */
export function Intro({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-caption font-semibold uppercase tracking-[0.2em] text-accent">Tastemaker by Sigmora</p>
      <h1 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">Don&apos;t guess the culture. Query it.</h1>
      <p className="mt-1 max-w-2xl text-body leading-snug text-muted">
        A marketing agent that plans your launch and checks every cultural pick against Qloo before it ships. The model proposes, Qloo scores,
        weak picks get cut, and every survivor carries a receipt.
      </p>
      {children}
    </div>
  );
}
