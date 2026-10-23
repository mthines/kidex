// Every toy needs an index.html with a <title> and no outside scripts.
import fs from 'node:fs';

let bad = 0;
for (const toy of fs.readdirSync('toys')) {
  const file = `toys/${toy}/index.html`;
  if (!fs.existsSync(file)) { console.log(`❌ ${toy}: no index.html`); bad++; continue; }
  const html = fs.readFileSync(file, 'utf8');
  if (!/<title>/i.test(html)) { console.log(`❌ ${toy}: no <title>`); bad++; }
  if (/<script[^>]+src=["']https?:/i.test(html)) { console.log(`❌ ${toy}: loads code from the internet`); bad++; }
  if (!bad) console.log(`✅ ${toy}`);
}
process.exit(bad ? 1 : 0);
