import { handleSp500Impact } from '../../../worker.js';

export async function onRequestGet(context) {
  return handleSp500Impact(context.request, context.env);
}

export async function onRequestPost(context) {
  return handleSp500Impact(context.request, context.env);
}
