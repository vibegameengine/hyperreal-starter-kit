import { useEffect, useState } from 'react'

import styles from './EditModeToggle.module.css'

type ModeState = { scene?: string; active: boolean; paused?: boolean }

function sceneOf(path: string) {
  const lab = /^\/labs\/([^/]+)/.exec(path)?.[1]
  if (lab) return `labs/${lab}`
  return path === '/' ? 'main' : undefined
}

export function EditModeToggle({ path }: { readonly path: string }) {
  const scene = sceneOf(path)
  const [active, setActive] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const hot = import.meta.hot
    if (!hot || !scene) return undefined
    setActive(false)
    setPaused(false)
    const onState = (state: ModeState) => {
      if (state.scene !== scene) return
      setActive(state.active)
      setPaused(Boolean(state.paused))
    }
    hot.on('vge:edit-mode-state', onState)
    hot.send('vge:edit-mode', { scene })
    return () => hot.off('vge:edit-mode-state', onState)
  }, [scene])

  if (!scene) return null
  return (
    <div className={styles.modes} role="radiogroup" aria-label="Game mode" data-testid="game-mode" onDoubleClick={(event) => event.stopPropagation()}>
      {[
        { id: 'play', label: 'Play', on: !active },
        { id: 'edit', label: 'Edit', on: active },
      ].map((mode) => (
        <button
          aria-checked={mode.on}
          className={styles.mode}
          data-testid={`game-mode-${mode.id}`}
          key={mode.id}
          onClick={() => import.meta.hot?.send('vge:edit-mode', { scene, active: mode.id === 'edit' })}
          role="radio"
          title={mode.id === 'edit' ? 'Edit the scene (F8)' : 'Play (F8)'}
          type="button"
        >
          {mode.label}
        </button>
      ))}
      {active ? (
        <button
          aria-pressed={paused}
          className={styles.mode}
          data-testid="game-pause"
          onClick={() => import.meta.hot?.send('vge:edit-mode', { scene, paused: !paused })}
          title={paused ? 'Resume the world (Pause)' : 'Pause the world (Pause)'}
          type="button"
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      ) : null}
    </div>
  )
}
