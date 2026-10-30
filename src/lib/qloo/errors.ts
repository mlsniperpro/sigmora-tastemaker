export class QlooBudgetError extends Error {
  constructor(
    readonly scope: "run" | "day",
    readonly cap: number,
  ) {
    super(scope === "run" ? `Qloo call budget for this run (${cap}) is spent` : `Today's Qloo call budget (${cap}) is spent`);
    this.name = "QlooBudgetError";
  }
}

/** The job's time for Qloo calls ran out; no further call is sent (queued ones included). */
export class QlooDeadlineError extends Error {
  constructor() {
    super("Out of time for Qloo calls in this run");
    this.name = "QlooDeadlineError";
  }
}

/** Errors that mean "stop asking Qloo for this job", not "Qloo is broken". */
export const isQlooStop = (err: unknown): err is QlooBudgetError | QlooDeadlineError => err instanceof QlooBudgetError || err instanceof QlooDeadlineError;

export class QlooSchemaError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string,
  ) {
    super(`Qloo response from ${path} did not match the expected shape: ${issues}`);
    this.name = "QlooSchemaError";
  }
}
