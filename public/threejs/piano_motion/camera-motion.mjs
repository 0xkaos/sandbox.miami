const STOPS = [
  { time: 0, x: -10, y: -20, z: 17, ahead: 0 },
  { time: 20, x: -8.5, y: -16.5, z: 14, ahead: 0 },
  { time: 44, x: -7, y: -17, z: 22, ahead: 0 },
  { time: 72, x: -10, y: -20, z: 17, ahead: 0 },
];

// Slow, repeatable movement on the music clock: home, closer, higher, then home again.
export function cameraDrift(time, enabled = true) {
  if (!enabled) return { x: -10, y: -20, z: 17, ahead: 0 };
  const phase = ((time % 72) + 72) % 72;
  const index = STOPS.findIndex((stop, i) => i < STOPS.length - 1 && phase < STOPS[i + 1].time);
  const from = STOPS[index], to = STOPS[index + 1];
  const fraction = (phase - from.time) / (to.time - from.time);
  const ease = (1 - Math.cos(fraction * Math.PI)) / 2;
  return Object.fromEntries(['x', 'y', 'z', 'ahead'].map(key => [key, from[key] + (to[key] - from[key]) * ease]));
}
