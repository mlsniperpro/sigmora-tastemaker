/**
 * Incremental NDJSON parser for the run stream: feed it chunks, get back
 * complete lines as values; `end()` flushes a final unterminated line.
 */
export class NdjsonParser<T> {
  private buf = "";

  constructor(private readonly parse: (line: string) => T = (l) => JSON.parse(l) as T) {}

  push(chunk: string): T[] {
    this.buf += chunk;
    const out: T[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) out.push(this.parse(line));
    }
    return out;
  }

  end(): T[] {
    const line = this.buf.trim();
    this.buf = "";
    return line ? [this.parse(line)] : [];
  }
}
