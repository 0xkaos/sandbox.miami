# Saved piano performances

Place `.mid` or `.midi` files here, including in subfolders. `npm run build` discovers them and regenerates `manifest.json`, which powers the **Saved performances** picker at `/threejs/piano_motion/`.

Commit the MIDI files along with your changes and push as usual. The Cloudflare build updates the picker automatically; no HTML or JavaScript edits are needed. For local testing, run `npm run dev` again after adding or removing files.

The picker uses filenames as titles (without the extension), supports spaces and Unicode, and opens the first saved performance on page load. Hidden files and non-MIDI files are ignored. The original piano study and local file upload remain available.

MIDI files with named left/right hand tracks use those assignments. A combined track, such as `The Interstellar Experience.mid`, uses a suggested pitch split. Adjust **Split hands at**, or assign a whole track under **Tracks & hands**. These controls change the visualization without changing the audio.
