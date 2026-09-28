/**
 * The solver, moved off the main thread.
 *
 * A run is a minute or two of solid arithmetic — a hundred thousand timesteps, each one
 * sweeping five hundred zones through an equation of state that costs a few transcendental
 * functions per call. On the main thread that is a frozen tab. Here it is a progress bar.
 *
 * Nothing about the physics changes by being in a worker. What does change is that the
 * result has to cross a thread boundary, and the result is ten megabytes of typed arrays:
 * seven hundred frames, each holding the radius, velocity, density, temperature, entropy,
 * composition and burning rate of every zone. Copying that is wasteful when the worker is
 * about to throw it away, so every buffer is handed over instead.
 */

import { runCollapse } from './hydro';
import type { RunSettings, WorkerMessage } from './types';

export interface RunRequest extends RunSettings {
  /** How far past bounce to run, in seconds. */
  endTime: number;
  /** Include timestep diagnostics in the progress text. */
  diagnose?: boolean;
}

const post = (message: WorkerMessage, transfer?: Transferable[]): void => {
  (self as unknown as Worker).postMessage(message, transfer ?? []);
};

self.onmessage = (event: MessageEvent<RunRequest>): void => {
  const request = event.data;
  try {
    // Progress arrives every few hundred steps. Posting all of them would flood the main
    // thread with messages it can only throw away, so they are thinned to about twenty a
    // second, which is faster than anyone can read a changing number anyway.
    let lastPost = 0;
    const result = runCollapse({
      heatingFactor: request.heatingFactor,
      endTime: request.endTime,
      diagnose: request.diagnose,
      onProgress: (fraction, note) => {
        const now = Date.now();
        if (now - lastPost < 50) return;
        lastPost = now;
        post({ kind: 'progress', fraction, note });
      },
    });

    const transfer: Transferable[] = [
      result.dm.buffer,
      result.mass.buffer,
      result.initialEntropy.buffer,
    ];
    for (const frame of result.frames) {
      transfer.push(
        frame.r.buffer,
        frame.v.buffer,
        frame.rho.buffer,
        frame.temp.buffer,
        frame.entropy.buffer,
        frame.comp.buffer,
        frame.burning.buffer,
      );
    }
    post({ kind: 'done', result }, transfer);
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
