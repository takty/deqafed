import { copyFileSync, cpSync, rmSync } from 'node:fs';

const entry = import.meta.resolve('opticm');
const source = new URL('./', entry);
const license = new URL('../LICENSE', entry);
const destination = new URL('../.generated-public/opticm/', import.meta.url);

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
copyFileSync(license, new URL('LICENSE', destination));
