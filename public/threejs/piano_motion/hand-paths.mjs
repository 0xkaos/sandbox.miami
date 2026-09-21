import { handGuidePose, lowerBound } from './performance.mjs';

export const MAX_HAND_BALLS = 4;
export const HAND_BALL_RADIUS = 0.18;
export const HAND_LANDING_HEIGHT = 0.27;
const CHORD_WINDOW = 0.045;

// Match every chord tone in pitch order, allowing one side to fork or converge.
// With at most four tones, we can examine every ordered mapping and choose the
// shortest total pitch movement without crossing the voices.
function connect(from, to) {
  const longer = Math.max(from.length, to.length), shorter = Math.min(from.length, to.length);
  let best, bestCost = Infinity;
  const visit = (indices, cost) => {
    const index = indices.length;
    if (index === longer) {
      if (indices.at(-1) === shorter - 1 && cost < bestCost) { best = indices; bestCost = cost; }
      return;
    }
    const previous = indices.at(-1) ?? 0;
    for (let small = previous; small <= Math.min(shorter - 1, previous + (index ? 1 : 0)); small++) {
      if (shorter - 1 - small > longer - 1 - index) continue;
      const a = from.length >= to.length ? from[index] : from[small];
      const b = from.length >= to.length ? to[small] : to[index];
      visit([...indices, small], cost + Math.abs(a.midi - b.midi));
    }
  };
  visit([], 0);
  return best.map((small, index) => ({ guide: [
    from.length >= to.length ? from[index] : from[small],
    from.length >= to.length ? to[small] : to[index],
  ] }));
}

export function buildHandPaths(notes) {
  const hands = { left: { groups: [], sections: [] }, right: { groups: [], sections: [] } };
  for (const note of notes) {
    const groups = hands[note.hand].groups;
    let group = groups.at(-1);
    if (!group || note.time - group.time >= CHORD_WINDOW) {
      group = { time: note.time, notes: [] };
      groups.push(group);
    }
    const unison = group.notes.find(other => other.midi === note.midi);
    if (unison) {
      unison.keyEnd = Math.max(unison.keyEnd, note.keyEnd);
      unison.end = Math.max(unison.end, note.end);
    } else group.notes.push({ ...note, time: group.time });
  }
  for (const hand of Object.values(hands)) {
    for (const group of hand.groups) {
      group.notes.sort((a, b) => a.midi - b.midi);
      if (group.notes.length > MAX_HAND_BALLS) {
        // Keep the outer voices and representative inner tones. Audio still plays every note.
        group.notes = Array.from({ length: MAX_HAND_BALLS }, (_, i) =>
          group.notes[Math.round(i * (group.notes.length - 1) / (MAX_HAND_BALLS - 1))]);
      }
    }
    hand.sections = hand.groups.map((group, index) => {
      const next = hand.groups[index + 1];
      return { time: group.time,
        end: next ? next.time : Math.max(...group.notes.map(note => note.keyEnd)) + 0.4,
        edges: next ? connect(group.notes, next.notes) : group.notes.map(note => ({ guide: [note] })),
      };
    });
  }
  return hands;
}

export function handPathEdgePose(edge, time, spacing, reduced = false) {
  const pose = handGuidePose(edge.guide, time, spacing, reduced);
  if (pose) pose.z += HAND_LANDING_HEIGHT - 0.32;
  return pose;
}

export function handPathPoses(path, time, spacing, reduced = false) {
  if (!path.sections.length) return [];
  const section = path.sections[Math.max(0, lowerBound(path.sections, time + 1e-7) - 1)];
  const poses = [];
  for (const edge of section.edges) {
    const pose = handPathEdgePose(edge, time, spacing, reduced);
    if (!pose || pose.opacity <= 0) continue;
    // A shared endpoint is one ball. The additional balls emerge as the paths separate.
    const shared = poses.find(other => Math.hypot(other.x - pose.x, other.y - pose.y, other.z - pose.z) < 0.035);
    if (shared) shared.opacity = Math.max(shared.opacity, pose.opacity);
    else poses.push(pose);
  }
  return poses;
}
