import { handleAcousticStates } from '../../../lib/acoustic-states.mjs';
export const onRequest = ({ request, env }) => handleAcousticStates(request, env);
