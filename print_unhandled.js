const fs = require('fs');
const audit = JSON.parse(fs.readFileSync('detailed_audit.json', 'utf8'));
const unhandled = [];
for (const cat in audit) {
  audit[cat].forEach(item => {
    if (item.status !== 'Working Handler') {
      unhandled.push({ cat, id: item.id, cls: item.cls, title: item.title, tag: item.tag, full: item.full });
    }
  });
}
console.log('Total unhandled:', unhandled.length);
console.log(JSON.stringify(unhandled, null, 2));
