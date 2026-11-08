import { captureSession, StaleRequestError } from '../api/client'

// A new scoped load or session change invalidates work started against older rows.
export function captureStoreRequest(store: { requestVersion: number }) {
  const version = store.requestVersion
  const sessionCurrent = captureSession()
  return () => sessionCurrent() && version === store.requestVersion
}

export function requireCurrent(current: () => boolean): void {
  if (!current()) throw new StaleRequestError()
}
