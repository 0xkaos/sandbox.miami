import { buildView } from './geometry.mjs';
self.onmessage = ({ data }) => {
    try {
        const start = performance.now(), view = buildView(data.snapshot,data.options), transfers = [];
        for (const layer of view.layers) if (layer) for (const key of ['positions','normals','indices']) if (layer[key]) transfers.push(layer[key].buffer);
        if (view.values) transfers.push(view.values.buffer);
        self.postMessage({ ...view, milliseconds:performance.now()-start },transfers);
    } catch (error) { self.postMessage({ error:error.message }); }
};
