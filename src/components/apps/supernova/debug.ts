/** Scratch harness: why is the shock radius jumping about? Run with ./run.sh debug.ts */
import { runCollapse } from './hydro';
import { M_SUN, SPECIES_COUNT, SP_FREE } from './constants';

const heat = Number(process.env.HEAT ?? '1.0');
const result = runCollapse({
  heatingFactor: heat,
  resolution: 'normal',
  endTime: Number(process.env.END ?? '0.4'),
  maxSteps: 400000,
});
console.log(`steps ${result.steps}, wall ${(result.elapsed / 1000).toFixed(1)}s`);

const want = (process.env.AT ?? '0.10,0.20,0.30').split(',').map(Number);
for (const target of want) {
  let f = result.frames[0];
  let best = Infinity;
  for (const g of result.frames) {
    const d = Math.abs(g.sinceBounce - target);
    if (d < best && g.sinceBounce > 0) {
      best = d;
      f = g;
    }
  }
  console.log(
    `\n=== t-tb=${f.sinceBounce.toFixed(4)}  R_shock=${(f.shockRadius / 1e5).toFixed(0)}km ` +
      `R_nu=${(f.neutrinoSphere / 1e5).toFixed(0)}km inner=${f.inner} L=${f.neutrinoLuminosity.toExponential(2)}`,
  );
  console.log(' zone    r(km)     v(km/s)     rho       T(K)      S     S/S0   X_free');
  let shown = 0;
  for (let i = f.inner; i < result.count; i += 1) {
    const r = f.r[i + 1] / 1e5;
    if (r < 40 || r > 1200) continue;
    shown += 1;
    if (shown % Number(process.env.STRIDE ?? '1') !== 0) continue;
    console.log(
      `${String(i).padStart(5)} ${r.toExponential(2)} ${(f.v[i + 1] / 1e5).toFixed(0).padStart(9)}  ` +
        `${f.rho[i].toExponential(2)}  ${f.temp[i].toExponential(2)}  ` +
        `${f.entropy[i].toFixed(1).padStart(6)}  ${(f.entropy[i] / result.initialEntropy[i]).toFixed(1).padStart(6)}  ` +
        `${(f.comp[i * SPECIES_COUNT + SP_FREE] / 255).toFixed(2)}`,
    );
  }
}
