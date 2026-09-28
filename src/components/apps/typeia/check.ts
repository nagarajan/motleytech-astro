/**
 * Scratch harness: run both explosions and print everything worth checking against the
 * literature. Not shipped with the site — see run.sh.
 */

import { KM, M_SUN, R_EARTH, SPECIES, SPECIES_SHORT } from './constants';
import { buildWhiteDwarf, NEAR_CHANDRA, SUB_CHANDRA, soundSpeedOf } from './star';
import { buildBurnMap, sampleAt, inFoe, NR, NTHETA, TIMELINE_DURATION, type Scenario } from './model';

const pad = (s: string | number, n: number) => String(s).padStart(n);

function describeStar(name: string, mass: number, helium: number): void {
  const wd = buildWhiteDwarf(mass, helium, NR);
  console.log(`\n=== ${name} ===`);
  console.log(
    `mass ${(wd.totalMass / M_SUN).toFixed(3)} Msun   ` +
      `radius ${(wd.radius / KM).toFixed(0)} km (${(wd.radius / R_EARTH).toFixed(2)} Earth radii)`,
  );
  console.log(
    `central density ${wd.centralDensity.toExponential(2)} g/cm3   ` +
      `binding energy ${inFoe(wd.bindingEnergy).toFixed(3)} foe`,
  );
  console.log(
    `sound speed at centre ${(soundSpeedOf(wd.centralDensity) / KM).toFixed(0)} km/s` +
      (helium > 0 ? `   helium shell ${(wd.heliumMass / M_SUN).toFixed(3)} Msun` : ''),
  );
}

function describeExplosion(scenario: Scenario): void {
  const started = Date.now();
  const map = buildBurnMap(scenario);
  const elapsed = Date.now() - started;

  console.log(`\n=== ${scenario} detonation ===`);
  console.log(`built in ${elapsed} ms`);
  console.log(
    `nuclear ${inFoe(map.nuclearEnergy).toFixed(3)} foe   ` +
      `binding ${inFoe(map.star.bindingEnergy).toFixed(3)} foe   ` +
      `kinetic ${inFoe(map.kineticEnergy).toFixed(3)} foe`,
  );
  console.log(
    `${scenario === 'delayed' ? 'transition' : 'core ignition'} at ` +
      `${map.ddtTime === Infinity ? 'never' : `${map.ddtTime.toFixed(3)} s`}`,
  );

  const yields = Object.entries(map.yields)
    .filter(([, m]) => m > 0.004)
    .map(([k, m]) => `${SPECIES_SHORT[k as never]} ${m.toFixed(3)}`)
    .join('   ');
  console.log(`yields (Msun)   ${yields}`);

  console.log('\n   t(s)  phase          R(km)    burnt(Msun)  E(foe)');
  for (const t of [0, 0.25, 0.5, 0.75, 1.0, 1.15, 1.3, 1.6, 2.0, 3.0, 4.0]) {
    if (t > TIMELINE_DURATION) break;
    const s = sampleAt(map, t);
    console.log(
      `  ${pad(t.toFixed(2), 5)}  ${s.phase.padEnd(13)} ${pad((s.outerRadius / KM).toFixed(0), 7)}` +
        `  ${pad((s.burnedMass / M_SUN).toFixed(3), 10)}  ${pad(inFoe(s.nuclearEnergy).toFixed(3), 6)}`,
    );
  }

  // The state the detonation actually runs into. This is what decides the yields, so if
  // anything is off it will be off here first.
  if (map.ddtTime < TIMELINE_DURATION) {
    const at = sampleAt(map, map.ddtTime);
    const cold = sampleAt(map, 0);
    console.log(
      `\nat ignition of the detonation (t = ${map.ddtTime.toFixed(2)} s): ` +
        `R x${(at.outerRadius / cold.outerRadius).toFixed(2)}   ` +
        `central density ${at.density[0].toExponential(2)} (from ${cold.density[0].toExponential(2)})`,
    );
    console.log('   m/M    r(km)   rho then    rho now    what it becomes');
    for (let i = 4; i < NR; i += 18) {
      const mix = Object.entries(map.yields).length;
      let best = 'co';
      let bestValue = 0;
      const base = (i * NTHETA + (NTHETA >> 1)) * SPECIES.length;
      for (let s = 0; s < SPECIES.length; s += 1) {
        if (map.ash[base + s] > bestValue) {
          bestValue = map.ash[base + s];
          best = SPECIES[s];
        }
      }
      void mix;
      console.log(
        `  ${pad(map.star.q[i].toFixed(3), 5)} ${pad((at.radius[i] / KM).toFixed(0), 7)}  ` +
          `${cold.density[i].toExponential(2)}  ${at.density[i].toExponential(2)}   ` +
          `${SPECIES_SHORT[best as never]} (${(bestValue * 100).toFixed(0)}%)`,
      );
    }
  }

  // Leading-edge speed: the outermost shell, once it is coasting.
  const late = sampleAt(map, TIMELINE_DURATION);
  const earlier = sampleAt(map, TIMELINE_DURATION - 0.5);
  const edge = (late.radius[NR] - earlier.radius[NR]) / 0.5;
  console.log(`\nleading edge ${(edge / KM).toFixed(0)} km/s`);

  // Did the angular structure survive? Compare pole and equator nickel.
  let poleNi = 0;
  let equatorNi = 0;
  const ni = SPECIES.indexOf('ni');
  for (let i = 0; i < NR; i += 1) {
    poleNi += map.ash[(i * NTHETA + 0) * SPECIES.length + ni] * map.dm[i];
    equatorNi += map.ash[(i * NTHETA + (NTHETA >> 1)) * SPECIES.length + ni] * map.dm[i];
  }
  console.log(
    `nickel along the ignition axis vs across it: ` +
      `${(poleNi / M_SUN).toFixed(3)} / ${(equatorNi / M_SUN).toFixed(3)} Msun`,
  );

  let unburnt = 0;
  for (let idx = 0; idx < NR * NTHETA; idx += 1) {
    if (map.tBurn[idx] === Infinity) unburnt += map.dm[Math.floor(idx / NTHETA)] / NTHETA;
  }
  console.log(`never ignited: ${(unburnt / M_SUN).toFixed(3)} Msun`);
}

describeStar('near-Chandrasekhar', NEAR_CHANDRA.mass, NEAR_CHANDRA.helium);
describeStar('sub-Chandrasekhar', SUB_CHANDRA.mass, SUB_CHANDRA.helium);
describeExplosion('delayed');
describeExplosion('double');
