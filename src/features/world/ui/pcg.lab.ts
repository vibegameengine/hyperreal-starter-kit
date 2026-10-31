import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'pcg',
  title: 'PCG forest',
  description: "Unreal's Procedural Content Generation from TypeScript: a graph described in a .pcg.ts module and built by the content service samples a hill, keeps trees off steep slopes and a spline path, puts rocks on the slopes, and regenerates live from the HUD's density, slope and seed.",
  category: 'world',
  load: () => import('../labs/pcg'),
});
