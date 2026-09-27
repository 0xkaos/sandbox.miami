import { MistSimulation } from './model.mjs';
let simulation, generation = 0;
self.onmessage = ({ data }) => {
    try {
        if (data.type === 'configure') {
            generation = data.generation;
            simulation = new MistSimulation(data.config, data.smoothing);
            const mask = simulation.field.mask.slice();
            self.postMessage({ type:'ready', generation, meta:simulation.field.metadata(), mask }, [mask.buffer]);
        } else if (!simulation || data.generation !== generation) return;
        else if (data.type === 'tune') simulation.tune(data.changes);
        else if (data.type === 'smoothing') simulation.setSmoothing(data.value);
        else if (data.type === 'burst') simulation.burst();
        else if (data.type === 'step') {
            const frame = simulation.frame(data.seconds, data.recycle);
            self.postMessage({ type:'frame', generation, ...frame }, [frame.values.buffer]);
        } else if (data.type === 'capture') {
            const snapshot = simulation.capture(data.name, data.view);
            self.postMessage({ type:'snapshot', generation, snapshot }, [snapshot.energy.buffer, snapshot.pressure.buffer, snapshot.mask.buffer]);
        }
    } catch (error) { self.postMessage({ type:'error', generation, message:error.message }); }
};
