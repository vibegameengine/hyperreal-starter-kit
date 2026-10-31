import type { DevLab, DevLabCategory } from '../../shared/lib/devLab'
import { worldScreen } from '../../features/world'
import { LABS } from '../../../app/labs'
import { DEV_LAB_CATEGORIES } from './devLab'
import { LAB_PREVIEWS } from './previews'

function collectLabs(): readonly DevLab[] {
  return LABS.map(({ load: _gameLoad, ...lab }) => {
    const preview = LAB_PREVIEWS[lab.id]
    const devLab: DevLab = { ...lab, load: async () => ({ default: worldScreen(`labs/${lab.id}`, lab.title) }) }
    return preview ? { ...devLab, preview } : devLab
  }).sort((left, right) => left.title.localeCompare(right.title))
}

export const DEV_LABS = collectLabs()

export type DevLabGroup = {
  readonly category: DevLabCategory
  readonly labs: readonly DevLab[]
  readonly title: string
}

export function groupDevLabs(labs: readonly DevLab[] = DEV_LABS): readonly DevLabGroup[] {
  return DEV_LAB_CATEGORIES.map((category) => ({
    category: category.id,
    labs: labs.filter((lab) => lab.category === category.id),
    title: category.title,
  })).filter((group) => group.labs.length > 0)
}
