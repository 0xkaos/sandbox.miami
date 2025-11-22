const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'manifest.json');

// Directories to ignore when scanning for demos
const IGNORE_DIRS = ['assets', 'css', 'js', 'lib', 'vendor'];

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

                demos.push({
                    path: '/' + relativePath + '/', // Ensure trailing slash for folders
                    title: titleMatch ? titleMatch[1] : item.name,
                    description: descMatch ? descMatch[1] : 'No description available.',
                    category: baseUrl.split(path.sep)[0] || 'uncategorized'
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
const demos = scanDemos(PUBLIC_DIR);
console.log(`Found ${demos.length} demos.`);

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(demos, null, 2));
console.log('Manifest written to ' + OUTPUT_FILE);
