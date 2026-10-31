import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'vehicle',
  title: 'Vehicle',
  description: 'Chaos Vehicles from TypeScript: a car model beside the code is given wheels, suspension, an engine torque curve and gears in a TypeScript description, and the player drives it over ramps and bumps with WASD and the handbrake on Space.',
  category: 'world',
  load: () => import('../labs/vehicle'),
});
