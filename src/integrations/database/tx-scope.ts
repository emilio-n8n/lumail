import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Re-entrancy guard for database transactions.
 *
 * PGlite has a single connection, so a transaction opened *while another one is
 * already running* can never be scheduled: the inner one waits for the outer to
 * finish, and the outer is waiting for the inner. The request hangs forever with
 * no error anywhere — the most expensive kind of bug in this codebase.
 *
 * The correct pattern is to pass the open `tx` down to helpers
 * (`readCustomFields`, `listActivity`, `uniqueSlug`, `recordEvent`, …). This
 * module turns the mistake into an immediate, named failure instead of a hang.
 */

type TxScope = { depth: number }

const storage = new AsyncLocalStorage<TxScope>()

export class NestedTransactionError extends Error {
  constructor() {
    super(
      'A transaction was opened while another one was already running. ' +
        'PGlite has a single connection, so the inner transaction could never ' +
        'complete. Pass the open `tx` to the helper instead of opening a new one.',
    )
    this.name = 'NestedTransactionError'
  }
}

/** Runs `fn` inside a transaction scope, rejecting a nested open. */
export function runInTxScope<T>(fn: () => Promise<T>): Promise<T> {
  if (storage.getStore()) throw new NestedTransactionError()
  return storage.run({ depth: 0 }, fn)
}

/** True while a transaction scope is active on this async path. */
export function inTxScope(): boolean {
  return storage.getStore() !== undefined
}