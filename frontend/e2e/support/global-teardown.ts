// Playwright requires globalTeardown to be a file default-exporting one function.
// The real work (stopping the backend + static server) lives in ./servers.ts.
import { stopStack } from './servers';

export default async function globalTeardown(): Promise<void> {
  await stopStack();
}
