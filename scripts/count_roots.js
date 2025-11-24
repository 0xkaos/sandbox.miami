const fs = require('fs');
const path = require('path');

const VERBS_JSON_PATH = path.join(__dirname, '../public/threejs/verbs_galaxy/verbs.json');

try {
    const data = JSON.parse(fs.readFileSync(VERBS_JSON_PATH, 'utf8'));
    const roots = new Set();
    let verbCount = 0;
    for (const key in data) {
        verbCount++;
        const verb = data[key];
        if (verb.rt) {
            roots.add(verb.rt.join('.'));
        }
    }
    console.log(`Total Verbs: ${verbCount}`);
    console.log(`Total Roots: ${roots.size}`);
} catch (e) {
    console.error(e);
}
