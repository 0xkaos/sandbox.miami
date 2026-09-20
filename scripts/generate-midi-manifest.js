const fs = require('fs');
const path = require('path');

function scanMidiFiles(root, relative = '') {
    if (!fs.existsSync(root)) return [];
    const files = [];
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) files.push(...scanMidiFiles(root, name));
        else if (entry.isFile() && /\.midi?$/i.test(entry.name)) {
            files.push({
                title: name.replace(/\.midi?$/i, '').replace(/_/g, ' '),
                path: '/midi/' + name.split('/').map(encodeURIComponent).join('/'),
            });
        }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function generateMidiManifest() {
    const root = path.join(__dirname, '../public/midi');
    const files = scanMidiFiles(root);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(files, null, 2) + '\n');
    console.log(`MIDI library: ${files.length} files indexed in public/midi/manifest.json.`);
}

module.exports = { scanMidiFiles, generateMidiManifest };
if (require.main === module) generateMidiManifest();
