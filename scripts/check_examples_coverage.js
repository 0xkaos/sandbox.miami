const verbs = require('../public/threejs/hebrew_verbs/verbs.json');
let withExamples = 0;
let total = 0;
for (const key in verbs) {
    total++;
    if (verbs[key].examples && verbs[key].examples.length > 0) {
        withExamples++;
    }
}
console.log(`Total verbs: ${total}`);
console.log(`Verbs with examples: ${withExamples}`);
