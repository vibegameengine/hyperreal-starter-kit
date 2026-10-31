import type { ReactElement } from 'react';
import { param } from '../../../shared/material';
import { FULLY_GROWN } from '../growth/field';

export const metresBehindFront = (at: ReactElement) => (
  <custom
    description="GrowthFront"
    outputType="Float1"
    inputs={{ p: at, f: param('GrowthFront', [0, 0, FULLY_GROWN]) }}
    code="return (f.z - length(p.xy - f.xy)) / 100;"
  />
);
