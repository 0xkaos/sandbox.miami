const fs = require('fs');
const path = require('path');

const SOURCE_JSON_PATH = path.join(__dirname, '../data/verbs.json');
const TARGET_JSON_PATH = path.join(__dirname, '../public/threejs/hebrew_verbs/verbs.json');

function main() {
    console.log('Reading source JSON...');
    const sourceData = JSON.parse(fs.readFileSync(SOURCE_JSON_PATH, 'utf8'));
    
    console.log('Reading target JSON...');
    const targetData = JSON.parse(fs.readFileSync(TARGET_JSON_PATH, 'utf8'));

    let updatedCount = 0;

    for (const key in targetData) {
        if (sourceData[key]) {
            const sourceVerb = sourceData[key];
            const targetVerb = targetData[key];
            
            const newExamples = [];
            
            // Extract examples from conjugations
            if (sourceVerb.conjugations) {
                for (const tense in sourceVerb.conjugations) {
                    const forms = sourceVerb.conjugations[tense];
                    if (Array.isArray(forms)) {
                        forms.forEach(form => {
                            if (form.audio_example && form.example_sentence_he && form.example_sentence_en) {
                                // Check if we already have this example (avoid duplicates)
                                const exists = newExamples.some(ex => ex.audio === form.audio_example);
                                if (!exists && newExamples.length < 3) {
                                    newExamples.push({
                                        hebrew: form.example_sentence_he,
                                        transliteration: "", // Source doesn't have sentence transliteration
                                        translation: form.example_sentence_en,
                                        audio: form.audio_example
                                    });
                                }
                            }
                        });
                    }
                }
            }

            if (newExamples.length > 0) {
                targetVerb.examples = newExamples;
                updatedCount++;
            }
        }
    }

    console.log(`Updated ${updatedCount} verbs with correct audio references.`);
    
    console.log('Writing updated JSON...');
    fs.writeFileSync(TARGET_JSON_PATH, JSON.stringify(targetData, null, 2));
    console.log('Done.');
}

main();
