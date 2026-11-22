const fs = require('fs');
const items = JSON.parse(fs.readFileSync('interactive_elements.json', 'utf8'));

// Deduplicate by element or ID
const seen = new Set();
const unique = [];

for (const it of items) {
  const key = it.id ? `id:${it.id}` : `raw:${it.snippet}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(it);
  }
}

console.log(`Unique interactive elements: ${unique.length}`);
fs.writeFileSync('unique_interactive.json', JSON.stringify(unique, null, 2));

const unhandled = unique.filter(i => !i.handled);
console.log(`Unique unhandled: ${unhandled.length}`);
console.log(JSON.stringify(unhandled.map(u => ({ id: u.id, tag: u.tag, cls: u.cls, title: u.title })), null, 2));
