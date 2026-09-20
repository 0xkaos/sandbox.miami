const STOPS = [
  { time: 0, x: -14, y: -8, z: 14, ahead: 10 },
  { time: 20, x: -10.5, y: -6.8, z: 11.8, ahead: 8 },
  { time: 44, x: -8, y: -5, z: 19, ahead: 6 },
  { time: 72, x: -14, y: -8, z: 14, ahead: 10 },
];

// Slow, repeatable movement on the music clock: home, closer, higher, then home again.
export function cameraDrift(time, enabled = true) {
  if (!enabled) return { x: -14, y: -8, z: 14, ahead: 10 };
  const phase = ((time % 72) + 72) % 72;
  const index = STOPS.findIndex((stop, i) => i < STOPS.length - 1 && phase < STOPS[i + 1].time);
  const from = STOPS[index], to = STOPS[index + 1];
  const fraction = (phase - from.time) / (to.time - from.time);
  const ease = (1 - Math.cos(fraction * Math.PI)) / 2;
  return Object.fromEntries(['x', 'y', 'z', 'ahead'].map(key => [key, from[key] + (to[key] - from[key]) * ease]));
}
