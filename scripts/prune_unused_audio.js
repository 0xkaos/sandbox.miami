const fs = require('fs');
const path = require('path');

const VERBS_JSON_PATH = path.join(__dirname, '../public/threejs/hebrew_verbs/verbs.json');
const AUDIO_DIR = path.join(__dirname, '../public/audio');
const AUDIO2_DIR = path.join(__dirname, '../public/audio2');
const UNUSED_AUDIO_DIR = path.join(__dirname, '../unused_audio/audio');
const UNUSED_AUDIO2_DIR = path.join(__dirname, '../unused_audio/audio2');

function getAllFiles(dir) {
    try {
        return fs.readdirSync(dir).map(file => file);
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

        let filename;
        let targetSet = referencedFiles;

        // Handle audio/ folder
        if (relativePath.startsWith('audio/')) {
            // Convert .wav to .mp4 if necessary, as JSON might have .wav but files are .mp4
            filename = path.basename(relativePath).replace('.wav', '.mp4');
            referencedFiles.add(`audio/${filename}`);
        } 
        // Handle audio2/ folder
        else if (relativePath.startsWith('audio2/')) {
            filename = path.basename(relativePath).replace('.wav', '.mp4');
            referencedFiles.add(`audio2/${filename}`);
        }
    };

    // Traverse JSON
    for (const key in data) {
        const verb = data[key];

        // 1. Root audio
        if (verb.audio) {
            addRef(verb.audio);
        }

        // 2. Conjugations
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
        
        // 3. Infinitives (sometimes in a separate array or object)
        if (verb.inf && Array.isArray(verb.inf)) {
             verb.inf.forEach(i => {
                 if (i.aud) addRef(i.aud);
             });
        }

        // 4. Examples
        if (verb.examples && Array.isArray(verb.examples)) {
            verb.examples.forEach(ex => {
                if (ex.audio) addRef(ex.audio);
            });
        }
    }

    console.log(`Found ${referencedFiles.size} referenced audio files.`);

    // Process audio/ directory
    const audioFiles = getAllFiles(AUDIO_DIR);
    let movedAudioCount = 0;
    audioFiles.forEach(file => {
        const refKey = `audio/${file}`;
        if (!referencedFiles.has(refKey)) {
            const src = path.join(AUDIO_DIR, file);
            const dest = path.join(UNUSED_AUDIO_DIR, file);
            fs.renameSync(src, dest);
            movedAudioCount++;
        }
    });
    console.log(`Moved ${movedAudioCount} unused files from public/audio to unused_audio/audio`);

    // Process audio2/ directory
    const audio2Files = getAllFiles(AUDIO2_DIR);
    let movedAudio2Count = 0;
    audio2Files.forEach(file => {
        const refKey = `audio2/${file}`;
        if (!referencedFiles.has(refKey)) {
            const src = path.join(AUDIO2_DIR, file);
            const dest = path.join(UNUSED_AUDIO2_DIR, file);
            fs.renameSync(src, dest);
            movedAudio2Count++;
        }
    });
    console.log(`Moved ${movedAudio2Count} unused files from public/audio2 to unused_audio/audio2`);
    
    console.log('Done.');
}

main();
