const verbs = require('../public/threejs/hebrew_verbs/verbs.json');

const roots = {};

for (const key in verbs) {
    const verb = verbs[key];
    const rootStr = verb.rt.join('.');
    if (!roots[rootStr]) {
        roots[rootStr] = [];
    }
    roots[rootStr].push({
        key: key,
        binyan: verb.bnE,
        inf: verb.inf
    });
}

const sortedRoots = Object.entries(roots).sort((a, b) => b[1].length - a[1].length);

console.log(`Total unique roots: ${sortedRoots.length}`);
console.log(`Roots with > 1 verb: ${sortedRoots.filter(r => r[1].length > 1).length}`);

console.log('Top 10 roots by verb count:');
sortedRoots.slice(0, 10).forEach(([root, list]) => {
    console.log(`${root}: ${list.length} verbs`);
    list.forEach(v => console.log(`  - ${v.inf} (${v.binyan})`));
});
