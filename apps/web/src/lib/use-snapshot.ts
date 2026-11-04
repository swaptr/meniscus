import { useSyncExternalStore } from 'react'
import { snapshot, type Snapshot } from './snapshot.ts'

/** The routes' last loads, re-rendering when one writes. Sends no request. */
export const useSnapshot = (): Snapshot => useSyncExternalStore(snapshot.subscribe, snapshot.get)
