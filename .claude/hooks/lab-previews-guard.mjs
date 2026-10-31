#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let payload = {}
try {
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
} catch {
  process.exit(0)
}

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd())
const featuresDir = join(root, 'src', 'features')
const previewsDir = join(root, 'src', 'ui', 'app', 'ui', 'labs', 'previews')

export function labsWithoutPreview(features, previews) {
  if (!existsSync(features)) return []
  return readdirSync(features).flatMap((slice) => {
    const uiDir = join(features, slice, 'ui')
    if (!existsSync(uiDir)) return []
    return readdirSync(uiDir)
      .filter((name) => name.endsWith('.lab.ts'))
      .map((name) => name.slice(0, -'.lab.ts'.length))
      .filter((id) => !existsSync(join(previews, `${id}.webp`)))
  })
}

const missing = labsWithoutPreview(featuresDir, previewsDir)
if (missing.length === 0 || payload.stop_hook_active) process.exit(0)

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason: `Every lab has a preview, captured from its own rendered frame (agents/skills/dev-lab-authoring, rule 4). These labs have none: ${missing.join(', ')}. With npm run dev running, capture them: npm run labs:previews -- ${missing.join(' ')} - then check each webp shows the lab, and commit it with the lab.`,
  }),
)
