// Builds an Unreal asset pack already in the project's Content/<Name> (copied there, from Fab or a sample) into a
// content container of its own that every game mounts; the game code loads it by path, /Game/<Name>/...:
//   npm run pack -- <Name>
import { devServerUrl } from './engine.mjs';

const [name] = process.argv.slice(2);
if (!name) {
  console.error('usage: npm run pack -- <Name>   (the folder unreal/Content/<Name>)');
  process.exit(1);
}
const response = await fetch(`${devServerUrl()}/__vge/pack`, { method: 'POST', body: JSON.stringify({ name }) });
const result = await response.json();
if (result.error) {
  console.error(`[pack] ${name}: ${result.error}`);
  process.exit(1);
}
console.log(`[pack] ${name} -> ${result.container}`);
