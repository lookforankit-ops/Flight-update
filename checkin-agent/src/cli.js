// Terminal version:  node src/cli.js '{"flightNumber":"6E2134","date":"2026-11-20","from":"DEL","to":"BLR","confirmation":"ZX4R9T","passenger":"Asha Rao"}'
//               or:  node src/cli.js flight.json
import fs from 'node:fs';
import { CliPrompter } from './prompter.js';
import { runCheckin } from './run.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node src/cli.js <flight JSON or path to a .json file>');
  process.exit(1);
}
const flight = JSON.parse(fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg);
const prompter = new CliPrompter();
let browser;
const result = await runCheckin(flight, prompter, { onBrowser: (b) => { browser = b; } });
console.log(`\nResult: ${result.status}\n${result.summary}${result.seat ? `\nSeat: ${result.seat}` : ''}`);
if (result.downloads?.length) console.log(`Boarding pass saved to:\n  ${result.downloads.join('\n  ')}`);
if (browser) await prompter.rl.question('\nPress Enter to close the browser… ');
await browser?.close();
prompter.close();
