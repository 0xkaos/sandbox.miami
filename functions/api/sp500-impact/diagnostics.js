import { handleFmpDiagnostics } from '../../../worker.js';

export async function onRequestGet(context) {
  return handleFmpDiagnostics(context.request, context.env);
}

export async function onRequestPost(context) {
  return handleFmpDiagnostics(context.request, context.env);
}
