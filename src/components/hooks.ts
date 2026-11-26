import { useSyncExternalStore } from 'react'
import { engine } from '../lib/engine'

let snap = { outTime: 0, srcTime: 0, playing: false }
engine.subscribe(() => {
  if (snap.outTime !== engine.outTime || snap.playing !== engine.playing || snap.srcTime !== engine.srcTime) {
    snap = { outTime: engine.outTime, srcTime: engine.srcTime, playing: engine.playing }
  }
})

export function useTransport() {
  return useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => snap,
  )
}
