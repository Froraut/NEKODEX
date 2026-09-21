export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly buffered: Array<{ value: T; bytes: number }> = [];
  private bufferedBytes = 0;
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private failure?: { error: unknown };

  constructor(
    private readonly maxBuffered = 10_000,
    private readonly maxBufferedBytes?: number,
    private readonly measureBytes: (value: T) => number = () => 0,
  ) {}

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
      return;
    }
    if (this.buffered.length >= this.maxBuffered) throw new Error("Adapter event backlog exceeded");
    const valueBytes = this.measureBytes(value);
    if (this.maxBufferedBytes !== undefined && this.bufferedBytes + valueBytes > this.maxBufferedBytes) {
      throw new Error("Adapter event byte backlog exceeded");
    }
    this.buffered.push({ value, bytes: valueBytes });
    this.bufferedBytes += valueBytes;
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

  /** Cancel the producer/consumer exchange and discard events that were only queued for delivery. */
  cancel(): void {
    this.buffered.length = 0;
    this.bufferedBytes = 0;
    this.close();
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
        if (this.buffered.length > 0) {
          const entry = this.buffered.shift()!;
          this.bufferedBytes -= entry.bytes;
          return Promise.resolve({ value: entry.value, done: false });
        }
        if (this.failure) return Promise.reject(this.failure.error);
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
      return: () => {
        this.cancel();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
