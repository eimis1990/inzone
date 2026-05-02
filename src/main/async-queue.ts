/**
 * A simple async queue that can be consumed via `for await`.
 * Used to feed user messages into an Agent SDK `query()` call over the
 * lifetime of a session.
 */
export class AsyncQueue<T> {
  private items: T[] = [];
  private pending: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const resolve = this.pending.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.pending) {
      resolve({ value: undefined as unknown as T, done: true });
    }
    this.pending = [];
  }

  get isClosed(): boolean {
    return this.closed;
  }

  asIterable(): AsyncIterable<T> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next(): Promise<IteratorResult<T>> {
            if (self.items.length > 0) {
              return Promise.resolve({
                value: self.items.shift()!,
                done: false,
              });
            }
            if (self.closed) {
              return Promise.resolve({
                value: undefined as unknown as T,
                done: true,
              });
            }
            return new Promise((resolve) => self.pending.push(resolve));
          },
          return(): Promise<IteratorResult<T>> {
            self.close();
            return Promise.resolve({
              value: undefined as unknown as T,
              done: true,
            });
          },
        };
      },
    };
  }
}
