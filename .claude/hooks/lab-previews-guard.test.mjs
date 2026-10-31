import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const HOOK = join(import.meta.dirname, 'lab-previews-guard.mjs')
const REGISTRY = join(import.meta.dirname, '..', '..', 'vge', 'tools', 'lab-registry.mjs')
const roots = []

function kit(labs, previews) {
  const root = mkdtempSync(join(tmpdir(), 'lab-previews-'))
  roots.push(root)
  mkdirSync(join(root, 'src', 'app'), { recursive: true })
  mkdirSync(join(root, 'src', 'ui', 'app', 'labs'), { recursive: true })
  mkdirSync(join(root, 'vge', 'tools'), { recursive: true })
  copyFileSync(REGISTRY, join(root, 'vge', 'tools', 'lab-registry.mjs'))
  const labEntries = labs.map((id) => `  defineLab({\n    id: '${id}',\n    title: '${id}',\n  }),`).join('\n')
  writeFileSync(join(root, 'src', 'app', 'labs.ts'), `export const LABS = [\n${labEntries}\n];\n`)
  const previewEntries = previews.map((id) => `  '${id}': url,`).join('\n')
  writeFileSync(join(root, 'src', 'ui', 'app', 'labs', 'previews.ts'), `export const LAB_PREVIEWS = {\n${previewEntries}\n}\n`)
  return root
}

function stop(root, payload = {}) {
  const result = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' })
  return result.stdout ? JSON.parse(result.stdout) : null
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('lab previews guard', () => {
  it('blocks the stop and names every lab without a preview', () => {
    const answer = stop(kit(['vehicle', 'pcg', 'ragdoll'], ['ragdoll']))
    expect(answer.decision).toBe('block')
    expect(answer.reason).toContain('vehicle')
    expect(answer.reason).toContain('pcg')
    expect(answer.reason).not.toContain('ragdoll,')
    expect(answer.reason).toContain('npm run labs:previews -- ')
  })

  it('lets the stop through when every lab has a preview', () => {
    expect(stop(kit(['vehicle'], ['vehicle']))).toBeNull()
  })

  it('does not hold a stop it already held once', () => {
    expect(stop(kit(['vehicle'], []), { stop_hook_active: true })).toBeNull()
  })

  it('ignores a preview with no lab', () => {
    expect(stop(kit([], ['orphan']))).toBeNull()
  })
})
