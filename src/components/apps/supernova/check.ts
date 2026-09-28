/** Scratch harness: run with ./run.sh. Not shipped. */
import { buildStar } from './progenitor';
import { TEMPERATURE, YE } from './progenitor-data';
import { G, M_SUN, R_SUN, SPECIES_COUNT, SPECIES_LABEL, SPECIES } from './constants';
import { coldPressure, meanIonMass, thermalPressure } from './eos';

const star = buildStar();
console.log(
  `${star.count} zones, ${(star.totalMass / M_SUN).toFixed(3)} Msun, ` +
    `${(star.r[star.count] / R_SUN).toFixed(0)} Rsun`,
);

console.log('\nlayers');
for (const l of star.layers) {
  console.log(
    `  ${l.name.padEnd(18)} to ${(l.outer / 1e5).toExponential(2)} km  ` +
      `${(l.outerMass / M_SUN).toFixed(3)} Msun`,
  );
}

console.log('\n zone   m(Msun)     r(km)       rho        T(K)    T_model   ratio  Ye/Ye0  main');
for (let i = 0; i < star.count; i += 10) {
  let best = 0;
  for (let s = 1; s < SPECIES_COUNT; s += 1) {
    if (star.comp[i * SPECIES_COUNT + s] > star.comp[i * SPECIES_COUNT + best]) best = s;
  }
  console.log(
    `${String(i).padStart(5)} ${(star.mass[i + 1] / M_SUN).toFixed(4).padStart(9)} ` +
      `${(star.r[i + 1] / 1e5).toExponential(2)}  ${star.rho[i].toExponential(2)}  ` +
      `${star.temp[i].toExponential(2)}  ${TEMPERATURE[i].toExponential(2)}  ` +
      `${(star.temp[i] / TEMPERATURE[i]).toFixed(2).padStart(5)}  ` +
      `${(star.ye[i] / YE[i]).toFixed(3)}  ${SPECIES_LABEL[SPECIES[best]]}`,
  );
}

// Hydrostatic balance, in the solver's own discretisation: the pressure difference across
// each interface against the weight the interface has to carry.
const pressureOf = (i: number) =>
  coldPressure(star.rho[i], star.ye[i]) +
  thermalPressure(star.temp[i], star.rho[i], star.ye[i], meanIonMass(star.comp, i * SPECIES_COUNT));
const ratios = new Float64Array(star.count);
for (let i = 1; i < star.count; i += 1) {
  const dmFace = (star.dm[i] + star.dm[i - 1]) / 2;
  const weight = (G * star.mass[i] * dmFace) / (4 * Math.PI * star.r[i] ** 4);
  ratios[i] = (pressureOf(i - 1) - pressureOf(i)) / weight;
}
// A support ratio is a poor measure near the centre, where the weight being carried goes
// to zero and any pressure error looks enormous. What matters is how fast the imbalance
// actually moves the gas, so quote the speed each interface would reach in 50 ms of drift.
const report = (label: string, from: number, to: number) => {
  let worst = 1;
  let at = from;
  let fastest = 0;
  let fastestAt = from;
  for (let i = Math.max(from, 1); i < to; i += 1) {
    if (Math.abs(Math.log(ratios[i])) > Math.abs(Math.log(worst))) {
      worst = ratios[i];
      at = i;
    }
    const g = (G * star.mass[i]) / star.r[i] ** 2;
    const drift = Math.abs((ratios[i] - 1) * g) * 0.05;
    if (drift > fastest) {
      fastest = drift;
      fastestAt = i;
    }
  }
  console.log(
    `  ${label.padEnd(20)} worst ratio ${worst.toFixed(3)} at ${at}, ` +
      `drift up to ${(fastest / 1e5).toFixed(1)} km/s at ${fastestAt}`,
  );
};
console.log('\nhydrostatic support');
report('iron core', 1, 128);
report('everything outside', 128, star.count);

let hot = -1;
for (let i = 0; i < star.count; i += 1) if (star.temp[i] > 5e9) hot = i;
console.log(
  hot < 0
    ? 'no zone above 5e9 K'
    : `outermost zone above 5e9 K: ${hot}, r=${(star.r[hot + 1] / 1e5).toFixed(0)} km`,
);
console.log(`peak temperature ${Math.max(...star.temp).toExponential(2)} K`);
