/** Scratch harness: dump radial profiles at chosen times. Run with ./run.sh profile.ts */
import { runCollapse } from './hydro';
import { M_SUN, SPECIES_COUNT, SP_FE, SP_FREE, SP_HE, SP_SI, SP_O } from './constants';

const heat = Number(process.env.HEAT ?? '1.0');
const end = Number(process.env.END ?? '0.3');

const result = runCollapse({
  heatingFactor: heat,
  resolution: 'normal',
  endTime: end,
  maxSteps: Number(process.env.MAXSTEPS ?? '200000'),
});
console.log(`failed=${result.failed}`);
console.log(`steps ${result.steps}, frames ${result.frames.length}, wall ${(result.elapsed / 1000).toFixed(1)}s, bounce ${(result.bounceTime * 1e3).toFixed(1)}ms`);

const want = (process.env.AT ?? '0.005,0.05,0.15,0.3').split(',').map(Number);
for (const target of want) {
  let best = result.frames[0];
  let bestD = Infinity;
  for (const f of result.frames) {
    const d = Math.abs(f.sinceBounce - target);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  console.log('');
  console.log(
    `=== t - t_bounce = ${best.sinceBounce.toFixed(4)} s   phase=${best.phase}  ` +
      `R_shock=${(best.shockRadius / 1e5).toFixed(0)}km  R_pns=${(best.coreRadius / 1e5).toFixed(0)}km  ` +
      `R_nu=${(best.neutrinoSphere / 1e5).toFixed(0)}km  inner=${best.inner}`,
  );
  console.log(' zone   m(Msun)   r(km)      v(km/s)     rho        T(K)      S(kB)   Fe    He   free  Si   O');
  for (let i = best.inner; i < result.count; i += 4) {
    const m = result.mass[i + 1] / M_SUN;
    if (m > 3.0) break;
    const c = (s: number) => (best.comp[i * SPECIES_COUNT + s] / 255).toFixed(2);
    console.log(
      `${String(i).padStart(5)} ${m.toFixed(4).padStart(8)} ${(best.r[i + 1] / 1e5).toExponential(2)} ` +
        `${(best.v[i + 1] / 1e5).toFixed(0).padStart(8)}  ${best.rho[i].toExponential(2)}  ` +
        `${best.temp[i].toExponential(2)}  ${best.entropy[i].toFixed(1).padStart(6)}  ` +
        `${c(SP_FE)} ${c(SP_HE)} ${c(SP_FREE)} ${c(SP_SI)} ${c(SP_O)}`,
    );
  }
}

console.log('\n  t-tb(s)  phase       R_shock(km)  R_pns  R_nu   M_pns   rho_c      L_nu(erg/s)  E_exp(foe)  Ni56');
for (const f of result.frames) {
  if (f.sinceBounce < 0) continue;
  console.log(
    `${f.sinceBounce.toFixed(4).padStart(9)}  ${f.phase.padEnd(10)} ` +
      `${(f.shockRadius / 1e5).toFixed(0).padStart(9)} ${(f.coreRadius / 1e5).toFixed(0).padStart(6)} ` +
      `${(f.neutrinoSphere / 1e5).toFixed(0).padStart(6)} ${(f.coreMass / M_SUN).toFixed(3).padStart(7)} ` +
      `${f.centralDensity.toExponential(2)}  ${f.neutrinoLuminosity.toExponential(2)}   ` +
      `${(f.explosionEnergy / 1e51).toFixed(3).padStart(8)}  ${(f.nickel / M_SUN).toFixed(3)}  ` +
      `dt=${f.dt.toExponential(1)} ${f.limitCause}@${f.limitZone} r=${(f.r[f.limitZone + 1] / 1e5).toExponential(1)}km`,
  );
}
