// Turns the browser game engines into modules the room server can import, so the server and
// the phones always run the exact same rules. Runs before every deploy ([build] in wrangler.toml)
// and the output is committed too, so a deploy never depends on this step succeeding.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const jobs = [
  ["public/engine.js", "worker/gen/murlan-engine.js", "M, G"],
  ["public/players.js", "worker/gen/players.js", "PLAYERS"],
];
let changed = 0;
for (const [src, out, names] of jobs) {
  const code = readFileSync(new URL(src, root), "utf8");
  const text = `// GENERATED from ${src} by scripts/build.mjs. Do not edit: change ${src} and run \`npm run build\`.\n${code}\nexport { ${names} };\n`;
  let old = "";
  try { old = readFileSync(new URL(out, root), "utf8"); } catch {}
  if (old !== text) { writeFileSync(new URL(out, root), text); changed++; }
}
if (process.argv.includes("--check") && changed) { console.error("worker/gen is out of date: run npm run build"); process.exit(1); }
console.log(`build: ${changed} file(s) updated`);
