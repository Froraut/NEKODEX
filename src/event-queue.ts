export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffered: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failure?: { error: unknown };

  constructor(private readonly maxBuffered = 10_000) {}

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    if (this.buffered.length >= this.maxBuffered) throw new Error("Adapter event backlog exceeded");
    this.buffered.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      if (this.failure) waiter.reject(this.failure.error);
      else waiter.resolve({ value: undefined, done: true });
    }
  }

  /** Fail outside the bounded buffer, so saturation cannot prevent error delivery. */
  fail(error: unknown): void {
    if (this.closed) return;
    this.failure = { error };
    this.close();
  }

  async collect(): Promise<T[]> {
    const values: T[] = [];
    for await (const value of this) values.push(value);
    return values;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffered.length > 0) return Promise.resolve({ value: this.buffered.shift()!, done: false });
        if (this.failure) return Promise.reject(this.failure.error);
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
      return: () => {
        this.close();
        this.buffered.length = 0;
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
