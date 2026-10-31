export const COAST_LAYERS = ['Ground', 'Rock', 'Shore', 'Sand'] as const;
export type CoastLayer = (typeof COAST_LAYERS)[number];
export const COAST_TEXTURE_MAPS = ['Color', 'Normal', 'Surface'] as const;
export const CLIFF_ROCKS = ['CliffA', 'CliffB'] as const;
