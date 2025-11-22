const fs = require('fs');
const path = require('path');

const VERBS_JSON_PATH = path.join(__dirname, '../public/threejs/hebrew_verbs/verbs.json');
const AUDIO_DIR = path.join(__dirname, '../public/audio');
const AUDIO2_DIR = path.join(__dirname, '../public/audio2');

function getAllFiles(dir) {
    try {
        return fs.readdirSync(dir).map(file => path.join(dir, file));
    } catch (e) {
        console.warn(`Could not read directory ${dir}: ${e.message}`);
        return [];
    }
}

function main() {
    console.log('Reading verbs.json...');
    const data = JSON.parse(fs.readFileSync(VERBS_JSON_PATH, 'utf8'));
    
    const referencedFiles = new Set();

    // Helper to add file to set if it exists
    const addRef = (relativePath) => {
        if (!relativePath) return;

        // Handle audio/ folder (JSON has .wav, files are .mp4)
        if (relativePath.startsWith('audio/')) {
            const filename = path.basename(relativePath, '.wav') + '.mp4';
            referencedFiles.add(path.join(AUDIO_DIR, filename));
        } 
        // Handle audio2/ folder (JSON has .mp4, files are .mp4)
        else if (relativePath.startsWith('audio2/')) {
            const filename = path.basename(relativePath);
            referencedFiles.add(path.join(AUDIO2_DIR, filename));
        }
    };

    // Traverse JSON
    for (const key in data) {
        const verb = data[key];

        // 1. Conjugations
        if (verb.conjugations) {
            for (const tense in verb.conjugations) {
                const forms = verb.conjugations[tense];
                if (Array.isArray(forms)) {
                    forms.forEach(form => {
                        if (form.aud) addRef(form.aud);
                    });
                }
            }
        }

        // 2. Examples
        if (verb.examples && Array.isArray(verb.examples)) {
            verb.examples.forEach(ex => {
                if (ex.audio) addRef(ex.audio);
            });
        }
    }

    console.log(`Found ${referencedFiles.size} referenced audio files.`);

    // Check actual files
    const actualAudio1 = getAllFiles(AUDIO_DIR);
    const actualAudio2 = getAllFiles(AUDIO2_DIR);
    const allActualFiles = [...actualAudio1, ...actualAudio2];

    console.log(`Found ${allActualFiles.length} actual audio files on disk.`);

    let deletedCount = 0;
    let keptCount = 0;

    allActualFiles.forEach(filePath => {
        if (!referencedFiles.has(filePath)) {
            // console.log(`Deleting unreferenced file: ${filePath}`);
            fs.unlinkSync(filePath);
            deletedCount++;
        } else {
            keptCount++;
        }
    });

    console.log(`Cleanup complete.`);
    console.log(`Deleted: ${deletedCount}`);
    console.log(`Kept: ${keptCount}`);
}

main();
