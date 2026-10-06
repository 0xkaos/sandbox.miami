import { copyFile, mkdir } from 'node:fs/promises';

const target = 'public/vendor/quill';
await mkdir(target, { recursive: true });
await Promise.all([
  copyFile('node_modules/quill/dist/quill.js', `${target}/quill.js`),
  copyFile('node_modules/quill/dist/quill.snow.css', `${target}/quill.snow.css`),
]);