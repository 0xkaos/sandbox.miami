const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

app.post('/api/save-letters', (req, res) => {
    try {
        const filePath = path.join(__dirname, 'public/threejs/hebrew_script_writer/images/letters.json');
        fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
        console.log('Saved letters.json');
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving file:', err);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

app.listen(port, () => {
    console.log(`Hebrew Script Editor running at http://localhost:${port}/threejs/hebrew_script_writer/index.html`);
});
