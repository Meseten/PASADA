// Playwright requires globalSetup to be a file default-exporting one function.
// The real work (booting the backend + static server) lives in ./servers.ts.
import { startStack } from './servers';

export default async function globalSetup(): Promise<void> {
  await startStack();
}
