import { cp } from 'node:fs/promises';
for (const directory of ['parser', 'migrations'])
  await cp(
    new URL(`../${directory}`, import.meta.url),
    new URL(`../dist/backend/${directory}`, import.meta.url),
    { recursive: true, filter: (path) => !path.includes('__pycache__') },
  );
