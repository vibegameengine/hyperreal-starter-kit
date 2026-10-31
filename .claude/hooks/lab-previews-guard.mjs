#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)

let payload = {}
try {
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
} catch {
  process.exit(0)
}

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? payload.cwd ?? process.cwd())
const registry = join(root, 'vge', 'tools', 'lab-registry.mjs')
if (!existsSync(registry) || !existsSync(join(root, 'src', 'app', 'labs.ts'))) process.exit(0)

const { labIds, previewIds } = await import(pathToFileURL(registry).href)
const previewed = new Set(previewIds(root))
const missing = labIds(root).filter((id) => !previewed.has(id))
if (missing.length === 0 || payload.stop_hook_active) process.exit(0)

process.stdout.write(
  JSON.stringify({
    decision: 'block',
    reason: `Every lab has a preview, captured from its own rendered frame (agents/skills/dev-lab-authoring, rule 4). These labs in src/app/labs.ts have none in src/ui/app/labs/previews.ts: ${missing.join(', ')}. With npm run dev running, capture them: npm run labs:previews -- ${missing.join(' ')} - check each webp shows the lab, import it in previews.ts, and commit it with the lab.`,
  }),
)
