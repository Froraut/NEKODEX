/** Runtime-owned, per-URL routes. Only transient transport failures retain a bounded lease. */
export class NativeRouteCache {
  private entries = new Map<string, { proxy: string; verifiedAt: number; refreshAt: number; blocked?: Error; pending?: Promise<string> }>();
  constructor(private clock = () => performance.now()) {}
  seed(url: string, proxy: string): void {
    if (!this.entries.has(url)) this.entries.set(url, { proxy, verifiedAt: this.clock(), refreshAt: 0 });
  }
  /** Detached use retains the same five-minute lease and never revives a rejected route. */
  cached(url: string): string | undefined {
    const entry = this.entries.get(url);
    if (entry?.blocked) throw entry.blocked;
    return entry && this.clock() - entry.verifiedAt < 300_000 ? entry.proxy : undefined;
  }
  async resolve(url: string, refresh: () => Promise<string>, transient: (error: unknown) => boolean): Promise<string> {
    let entry = this.entries.get(url);
    const now = this.clock();
    const usable = entry && !entry.blocked && now - entry.verifiedAt < 300_000;
    if (entry && now < entry.refreshAt) {
      if (usable) return entry.proxy;
      if (entry.blocked) throw entry.blocked;
    }
    if (!entry) {
      // Bound arbitrary first-party endpoint/query variants without changing their route identity.
      if (this.entries.size >= 64) this.entries.delete(this.entries.keys().next().value!);
      entry = { proxy: '', verifiedAt: -Infinity, refreshAt: 0 };
      this.entries.set(url, entry);
    }
    if (!entry.pending) {
      const current = entry;
      current.pending = refresh().then(proxy => {
        current.proxy = proxy;
        current.verifiedAt = this.clock();
        current.refreshAt = this.clock() + 30_000;
        current.blocked = undefined;
        return proxy;
      }, error => {
        current.refreshAt = this.clock() + 10_000;
        if (!transient(error)) current.blocked = error instanceof Error ? error : new Error('Native route rejected');
        throw error;
      }).finally(() => { current.pending = undefined; });
    }
    if (usable) {
      void entry.pending!.catch(() => {});
      return entry.proxy;
    }
    return entry.pending!;
  }
}
