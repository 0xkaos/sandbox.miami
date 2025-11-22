# sandbox.miami 🌴

An interactive Three.js sandbox hosted on Cloudflare Pages. This project showcases 3D graphics capabilities with Three.js, featuring rotating geometric shapes, particle systems, and interactive controls.

## Features

- 🎨 Interactive 3D scene with Three.js
- 🔄 Auto-rotating torus knot with orbiting spheres
- ✨ Particle system background
- 🎮 Orbit controls (click and drag to rotate, scroll to zoom)
- 📱 Responsive design for mobile and desktop
- ⚡ Hosted on Cloudflare Pages for fast global delivery

## Live Demo

Visit the live demo at: `https://sandbox-miami.pages.dev` (or your custom domain)

## Local Development

1. Clone the repository:
```bash
git clone https://github.com/0xkaos/sandbox.miami.git
cd sandbox.miami
```

2. Open `index.html` in your browser:
```bash
# Using Python
python -m http.server 8000

# Using Node.js (http-server)
npx http-server

# Or simply open the file
open index.html
```

3. Navigate to `http://localhost:8000` in your browser

## Deployment to Cloudflare Pages

### Option 1: Via Git Integration (Recommended)

1. Log in to your [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Pages** > **Create a project**
3. Connect your GitHub repository
4. Configure the build settings:
   - **Build command**: (leave empty)
   - **Build output directory**: `/`
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
wrangler pages deploy . --project-name=sandbox-miami
```

## Project Structure

```
sandbox.miami/
├── index.html          # Main HTML file with Three.js scene
├── package.json        # Project metadata and scripts
├── wrangler.json       # Cloudflare Workers/Pages configuration
├── _headers            # Security and caching headers
├── .gitignore          # Git ignore file
└── README.md           # This file
```

## Technologies Used

- **Three.js** (v0.160.0) - 3D graphics library
- **Cloudflare Pages** - Static site hosting
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

Built with ❤️ using Three.js and Cloudflare Pages