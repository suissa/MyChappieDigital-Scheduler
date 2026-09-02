/**
 * In-memory KV + optimistic-lock adapter.
 *
 * The behaviours only know the `KvPort` / `LockPort` interfaces; this is the
 * process-local implementation used by the vertical slice and the tests. A
 * production deployment would swap in Redis/Postgres behind the same ports
 * without touching a single behaviour.
 */

import type { KvPort, LockPort } from "../behaviors/kind.js";

export class MemoryStore implements KvPort, LockPort {
  readonly #data = new Map<string, Map<string, unknown>>();
  readonly #locks = new Map<string, string>();

  #ns(namespace: string): Map<string, unknown> {
    let m = this.#data.get(namespace);
    if (!m) {
      m = new Map();
      this.#data.set(namespace, m);
    }
    return m;
  }

  async get<T>(namespace: string, key: string): Promise<T | undefined> {
    return this.#ns(namespace).get(key) as T | undefined;
  }

  async put<T>(namespace: string, key: string, value: T): Promise<void> {
    if (value === undefined) {
      this.#ns(namespace).delete(key);
      return;
    }
    this.#ns(namespace).set(key, value);
  }

  async del(namespace: string, key: string): Promise<void> {
    this.#ns(namespace).delete(key);
  }

  async list<T>(namespace: string): Promise<ReadonlyArray<readonly [string, T]>> {
    return [...this.#ns(namespace).entries()] as ReadonlyArray<readonly [string, T]>;
  }

  async compareAndSet(
    namespace: string,
    key: string,
    expected: string | undefined,
    next: string | undefined,
  ): Promise<boolean> {
    const lk = `${namespace}::${key}`;
    const current = this.#locks.get(lk);
    if (current !== expected) return false;
    if (next === undefined) this.#locks.delete(lk);
    else this.#locks.set(lk, next);
    return true;
  }

  /** Test/inspection helper — not part of the ports. */
  snapshot(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [ns, m] of this.#data) out[ns] = Object.fromEntries(m);
    return out;
  }
}
