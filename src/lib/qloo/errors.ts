export class QlooBudgetError extends Error {
  constructor(
    readonly scope: "run" | "day",
    readonly cap: number,
  ) {
    super(scope === "run" ? `Qloo call budget for this run (${cap}) is spent` : `Today's Qloo call budget (${cap}) is spent`);
    this.name = "QlooBudgetError";
  }
}

export class QlooSchemaError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string,
  ) {
    super(`Qloo response from ${path} did not match the expected shape: ${issues}`);
    this.name = "QlooSchemaError";
  }
}
