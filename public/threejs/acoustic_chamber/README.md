# Resonant Chamber

Open `/threejs/acoustic_chamber/` for a silent, interactive study of three-dimensional acoustic interference and spatial cymatics. Everything runs locally in the browser; WebGL 2 is required. There are no external runtime requests.

## Exploring

- Drag to orbit and scroll or pinch to zoom. Hide the controls for an unobstructed view.
- Amber shows compression and blue shows rarefaction. Leave the continuous source running to let a particle pattern develop; **Particles only** reveals its structure.
- The default 48,000 fine points can be increased to 120,000, with a separate **Point size** slider. Three populations trace neighboring pressure-energy bands: pearl seeks quiet nodes, cyan seeks a low-energy contour, and rose seeks a slightly higher contour. **Quiet nodes · color by energy** restores the original motion for all particles and changes their colors with the local field instead. Switching modes preserves the current field and particle positions.
- Adjust frequency, amplitude, wall return, and particle response while running. A stronger wall return gives more persistent interference. The default 38% pressure return corresponds to roughly 14% after two normal-incidence reflections, before other losses.
- **Send a burst** emits a smooth three-cycle pulse, useful for watching arrivals, reflections, and decay. Continuous excitation keeps supplying new energy even when individual reflections fade quickly.
- Open the circular outlet opposite the horn to change the reflected field and see sound propagate outside. The size of the change depends on outlet diameter, wavelength, and wall return; a small hole will not necessarily transform the whole pattern.
- Rectangular, elliptical-cylinder, and tapered chambers have independent length, height, and depth controls. Geometry changes restart the field. **Restart field** clears it at any time; **Redistribute particles** keeps the current wave field.
- Wave motion is slowed by 50–200×. Particle motion is deliberately accelerated and follows display time. On slower devices, reduce particle count, use **Light** field detail, or choose **Particles only**. Heavy load can slow simulation time further to preserve numerical stability.

## Acoustic model and limits

`physics.mjs` solves the scalar 3D wave equation on an isotropic, six-neighbor finite-difference grid in a dedicated module worker. Sound speed is 343 m/s. The time step uses a Courant number of 0.48, below the three-dimensional stability limit of 1/√3. The frequency slider is limited to wavelengths of at least nine cells; this reduces numerical dispersion but does not make the result an engineering-grade prediction.

The horn drives a radially tapered circular patch of the left wall with the time derivative of a sinusoidal velocity source. Its visible flare is decorative: propagation within the horn itself is not simulated. Bursts use a three-cycle Hann envelope. A small bulk loss and passive, centered-in-time wall damping remove energy. The wall's normalized admittance is approximated by `(1 − R) / (1 + R)`, where R is the selected normal-incidence pressure reflection coefficient. Return varies with angle and grid resolution.

An enabled outlet is an actual opening in the grid's end wall, connected to an exterior region with gradually increasing absorption and lossy outer boundaries. This finite absorbing region is an approximation to open air, not a perfectly matched layer or an exact radiation impedance. Curved surfaces, the aperture, and dimensions are voxel approximations; low detail changes their effective geometry. Pressure is displayed using a ray-marched 3D texture or a central pressure section.

Particles use the exponentially averaged pressure-energy field `E = ⟨p²⟩`, with a two-cycle time constant, drag, and capped acceleration. Pearl particles follow `−∇E`. In three-band mode, cyan and rose particles seek contours at 0.18 and 0.55 times the chamber's mean energy by following a scaled, capped `−(E − target)∇E` force. The targets move with the field. In quiet-node mode, every particle follows `−∇E`; colors indicate local energy ranges below 0.09, from 0.09 to 0.365, and above 0.365 times the mean (with a small normalization floor near silence).

Particle response is exaggerated and normalized for legibility. The colored populations are field tracers, not different physical materials. The model does not solve the full acoustic radiation force, fluid streaming, material contrast, gravity, or particle collisions. Escaping particles are recycled into the chamber. A pressure node is a region of small pressure oscillation, not permanently low-density air. Dimensions and frequencies have physical units; pressure, source amplitude, and particle response are relative.

This is a qualitative sketch for exploring patterns, not a calibrated loudspeaker-box, levitation, or room-acoustics design tool.

Background references: [COMSOL on acoustic radiation force](https://www.comsol.com/blogs/how-to-compute-the-acoustic-radiation-force), [locally reacting impedance boundaries](https://doc.comsol.com/6.4/doc/com.comsol.help.aco/aco_ug_pressure.05.113.html), and [local versus extended boundary reaction](https://www.comsol.com/blogs/sound-absorbing-boundaries-local-vs-extended-reaction).

## Validation and build

```sh
node --test scripts/test-acoustic-chamber.mjs
npm run build
npm run dev
```

Numerical checks cover stability, amplitude scaling, burst decay, outlet transmission, geometry/frequency effects, and particle attraction to a known potential. The normal project build adds the sketch to the front-page manifest; Cloudflare Pages serves these static files directly.

See [THIRD_PARTY.md](THIRD_PARTY.md) for bundled dependencies.
