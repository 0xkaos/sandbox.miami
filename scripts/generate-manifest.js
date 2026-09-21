const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, '../public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'manifest.json');

// Directories to ignore when scanning for demos
const IGNORE_DIRS = ['assets', 'css', 'js', 'lib', 'vendor'];

function creationDates() {
    const dates = new Map();
    try {
        const history = execFileSync('git', ['log', '--reverse', '--find-renames', '--diff-filter=AR',
            '--format=COMMIT%x00%cI', '--name-status', '-z', '--', ':(glob)public/**/index.html'],
        { cwd: ROOT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0');
        let date;
        for (let i = 0; i < history.length; i++) {
            const kind = history[i].trim();
            if (kind === 'COMMIT') date = history[++i];
            else if (kind === 'A') dates.set(history[++i], date);
            else if (/^R\d+$/.test(kind)) {
                const before = history[++i], after = history[++i];
                dates.set(after, dates.get(before) || date);
            }
        }
    } catch { /* Exported source trees can build from the dates already in the manifest. */ }
    return dates;
}

// Preserve recorded dates across shallow deployment checkouts and later edits to a demo.
let previous = [];
try { previous = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')); } catch { /* First build. */ }
if (!Array.isArray(previous)) previous = [];
const recordedDates = new Map(previous.filter(demo => demo && Number.isFinite(Date.parse(demo.createdAt)))
    .map(demo => [demo.path, demo.createdAt]));
const gitDates = creationDates();

function scanDemos(dir, baseUrl = '') {
    let demos = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.join(baseUrl, item.name);

        if (item.isDirectory()) {
            if (IGNORE_DIRS.includes(item.name)) continue;

            // Check if this directory has an index.html
            const indexPath = path.join(fullPath, 'index.html');
            if (fs.existsSync(indexPath)) {
                // It's a demo! Extract metadata
                const htmlContent = fs.readFileSync(indexPath, 'utf-8');
                const titleMatch = htmlContent.match(/<title>(.*?)<\/title>/i);
                const descMatch = htmlContent.match(/<meta\s+name=["']description["']\s+content=["'](.*?)["']\s*\/?>/i) || 
                                  htmlContent.match(/<meta\s+content=["'](.*?)["']\s+name=["']description["']\s*\/?>/i);

                // Skip the main splash page
                if (relativePath === 'index.html' || relativePath === '') continue;

                const url = '/' + relativePath.split(path.sep).map(encodeURIComponent).join('/') + '/';
                const repositoryPath = path.relative(ROOT_DIR, indexPath).split(path.sep).join('/');
                demos.push({
                    path: url,
                    title: titleMatch ? titleMatch[1] : item.name,
                    description: descMatch ? descMatch[1] : 'No description available.',
                    category: baseUrl.split(path.sep)[0] || item.name || 'uncategorized',
                    createdAt: recordedDates.get(url) || gitDates.get(repositoryPath) || fs.statSync(indexPath).mtime.toISOString()
                });
            } else {
                // Recurse deeper
                demos = demos.concat(scanDemos(fullPath, relativePath));
            }
        }
    }
    return demos;
}

console.log('Scanning for demos in ' + PUBLIC_DIR + '...');
const demos = scanDemos(PUBLIC_DIR).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    || a.title.localeCompare(b.title, 'en') || a.path.localeCompare(b.path, 'en'));
console.log(`Found ${demos.length} demos.`);

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(demos, null, 2));
console.log('Manifest written to ' + OUTPUT_FILE);

require('./generate-midi-manifest').generateMidiManifest();
