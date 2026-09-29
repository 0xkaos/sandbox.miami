# sandbox.miami 🌴

An interactive Three.js sandbox hosted on Cloudflare Workers with static assets. This project showcases 3D graphics capabilities with Three.js, featuring rotating geometric shapes, particle systems, and interactive controls.

## Features

- 🌍 **Human Atlas**: Open `/threejs/human_atlas/` for a navigable history globe with fixed-scale HYDE population spikes, migration and ancestry studies, historical territories, and exportable regional snapshots. [Controls, sources, and data limits](public/threejs/human_atlas/README.md).
- 🔊 **Resonant Chamber**: Open `/threejs/acoustic_chamber/` for a 3D acoustic field, lossy reflections, an optional outlet, and particles collecting around quiet interference regions. [Controls and model](public/threejs/acoustic_chamber/README.md).
- 👁 **Gaze Field**: Open `/threejs/gaze_lab/` to experiment with local webcam gaze tracking, 5/9/17-point calibration, and an independent accuracy check. [Setup and LifeCam troubleshooting](public/threejs/gaze_lab/README.md).
- 🎹 **Piano / Motion**: Open `/threejs/piano_motion/` for local MIDI import, a 16-velocity sampled grand piano, and an animated 3D staff. [Workflow, sound design, and limitations](public/threejs/piano_motion/README.md).
- 🎨 Interactive 3D scene with Three.js
- 🌌 **Verbs Galaxy**: A data visualization of 350+ Hebrew verbs with audio pronunciation and example sentences.
- 🔍 **Search**: Deep search capability to find verbs by root, meaning, or context.
- 🔄 Auto-rotating torus knot with orbiting spheres
- ✨ Particle system background
- 🎮 Orbit controls (click and drag to rotate, scroll to zoom)
- 📱 Responsive design for mobile and desktop
- ⚡ Hosted on Cloudflare Workers for fast global delivery

## Live Demo

Visit the live demo at: [sandbox.miami](https://sandbox.miami).

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/0xkaos/sandbox.miami.git
cd sandbox.miami
```

2. Generate the demo catalog and serve the public directory:
```bash
npm install
npm run dev
```

3. Navigate to `http://localhost:8000` in your browser

The front page lists experiments newest first. The build uses each page's original Git addition date when available, follows renames, and records `createdAt` in `public/manifest.json`. Recorded dates stay stable through later edits, shallow deployment checkouts, and builds without Git history. A new page without history uses its file modification date on its first build.

## Production deployment: Cloudflare Workers

The production site is [sandbox.miami](https://sandbox.miami), served by the `sandbox` Worker with static assets from `public`. Its fallback address is [sandbox.jonathon-russell.workers.dev](https://sandbox.jonathon-russell.workers.dev). `wrangler.toml` records the custom domain, Durable Object, and R2 bindings.

In **Workers & Pages > sandbox > Settings > Build**, use `npm run build` as the build command and `npx wrangler deploy` as the deploy command. To deploy locally:

```bash
npx wrangler login
npm run build
npx wrangler deploy
```

The existing `npm run deploy` script targets the legacy Pages setup below; use the Worker commands above for production.

### Deployment notes (2026-09-29)

- A deployment stalled at **Initializing build environment** before cloning or running project commands. A retry succeeded without code changes; initialization still took about three minutes. Check the final failure line and [Workers Builds status](https://www.cloudflarestatus.com/) before treating this symptom as an application build error.
- The successful log reported a dashboard/configuration mismatch because `sandbox.miami` was missing from local `routes`. The domain continued serving the atlas after that deploy. It is now declared in `wrangler.toml`, following [Cloudflare's custom-domain configuration](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#set-up-a-custom-domain-in-your-wrangler-configuration-file). Review future configuration diffs rather than suppressing the warning. The asset directory and R2 preview bucket in the log match the intended local setup.
- npm warned about unreviewed install scripts in `esbuild@0.25.4`, `sharp@0.33.5`, and `workerd@1.20251118.0`. Installation and deployment succeeded. When maintaining dependencies, review the scripts and record package-specific approvals using [npm's documented workflow](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/); the log does not justify blanket approval or an urgent dependency upgrade.
- The successful log ran `npx wrangler deploy` without a preceding `npm run build`. The committed manifests included the atlas, so this release worked; keep the build command above configured so future catalog changes are generated in CI.
- **Skipping build output cache** is informational. This project serves committed static files and only generates the demo and MIDI manifests.

## Legacy deployment: Cloudflare Pages

### Option 1: Via Git Integration (Recommended)

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Pages** > **Create a project**
3. Connect your GitHub repository
4. Configure the build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `public`
   - **Root directory**: `/`
5. Click **Save and Deploy**

### Option 2: Via Wrangler CLI

1. Install Wrangler:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy:
```bash
npm run build
npx wrangler pages deploy public --project-name=sandbox-miami
```

## Project Structure

```
sandbox.miami/
├── public/             # Static site and individual demos
│   ├── index.html      # Demo catalog
│   ├── manifest.json   # Generated by npm run build
│   └── threejs/        # Self-contained Three.js experiments
├── scripts/            # Catalog generator and regression checks
├── package.json        # Project metadata and scripts
├── wrangler.toml       # Worker configuration with public assets
├── functions/          # Cloudflare Pages API functions
├── public/_headers     # Security and caching headers
├── .gitignore          # Git ignore file
└── README.md           # This file
```

## Technologies Used

- **Three.js** (v0.160.0) - 3D graphics library
- **Cloudflare Workers** - Static assets and API hosting
- **ES Modules** - Modern JavaScript module system
- **OrbitControls** - Interactive camera controls

## Features in the Scene

1. **Torus Knot**: A complex geometric shape that rotates continuously
2. **Orbiting Spheres**: Five colorful spheres orbiting around the main shape
3. **Particle System**: 1000 particles creating a starfield effect
4. **Dynamic Lighting**: Ambient, directional, and point lights
5. **Interactive Controls**: Mouse/touch controls for camera manipulation

## Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

- [ ] Add more interactive examples
- [ ] Implement shader effects
- [ ] Add VR/AR support
- [ ] Create a gallery of different scenes
- [ ] Add UI controls for scene customization

## Contributing

Feel free to open issues or submit pull requests with improvements!

## License

MIT License - Feel free to use this project for learning and experimentation.

---

Built with ❤️ using Three.js and Cloudflare Workers
