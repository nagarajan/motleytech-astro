/**
 * Scratch harness. Runs the movement with no browser attached and prints the things that
 * are supposed to fall out of it: the beat rate, the amplitude at each state of wind, the
 * power reserve, and whether the hands agree with the clock. Not part of the site build.
 *
 *   ./run.sh
 */
import {
  ACTIVITY,
  ACTIVITY_BY_ID,
  AUTO_RATIO,
  BEATS_PER_HOUR,
  DEG,
  FULL_WIND,
  KEYLESS,
  Movement,
  TRAIN_RATIO,
  escapeTorque,
  settledAmplitude,
} from './movement';

/** Long enough for the amplitude to settle: it climbs with a time constant near a minute. */
const SETTLE = 240;

function pad(text: string | number, width: number): string {
  return String(text).padStart(width);
}

function wound(turns: number): Movement {
  const watch = new Movement();
  watch.letDown();
  watch.turnCrown(turns / (KEYLESS.windingPinion / KEYLESS.ratchet));
  return watch;
}

console.log('--- train ---');
{
  const watch = new Movement();
  watch.advance(SETTLE);
  const read = watch.read();
  console.log(`beat rate     ${pad(read.beatRate.toFixed(2), 10)} /h   (nominal ${BEATS_PER_HOUR})`);
  console.log(`rate          ${pad(read.rate.toFixed(3), 10)} s/day`);
  console.log(`amplitude     ${pad(read.amplitude.toFixed(1), 10)} deg`);
  console.log(`train seconds ${pad(watch.trainSeconds.toFixed(3), 10)}        (expect ~${SETTLE})`);
}

console.log('\n--- amplitude against wind ---');
console.log('  turns   barrel µN·m   escape nN·m    integrated    predicted');
for (const wind of [FULL_WIND, 4, 3, 2, 1, 0.5, 0.3, 0.2]) {
  const watch = wound(wind);
  watch.advance(SETTLE);
  const read = watch.read();
  const predicted = (settledAmplitude(escapeTorque(wind)) / DEG).toFixed(0);
  console.log(
    `  ${pad(wind.toFixed(1), 5)}   ${pad((read.barrelTorque * 1e6).toFixed(0), 11)}   ` +
      `${pad((read.escapeTorque * 1e9).toFixed(0), 11)}   ` +
      `${pad(read.running ? read.amplitude.toFixed(0) : 'stopped', 11)}   ` +
      `${pad(read.running ? predicted : '—', 10)}`,
  );
}

console.log('\n--- power reserve ---');
{
  const watch = new Movement();
  watch.fullWind();
  let hours = 0;
  let healthy = 0;
  while (watch.read().running && hours < 80) {
    watch.fastForward(600);
    hours += 1 / 6;
    if (watch.read().amplitude > 200) healthy = hours;
  }
  const read = watch.read();
  console.log(`ran for            ${pad(hours.toFixed(1), 6)} h`);
  console.log(`above 200 deg for  ${pad(healthy.toFixed(1), 6)} h`);
  console.log(`turns left         ${pad(read.wind.toFixed(2), 6)}`);
  console.log(`train vs clock     ${pad((watch.trainSeconds - read.elapsed).toFixed(1), 6)} s (the stopped tail)`);
}

console.log('\n--- winding and setting ---');
{
  const watch = new Movement();
  watch.letDown();
  watch.advance(5);
  console.log(`run down:      ${watch.read().running ? 'running' : 'stopped'}  (expect stopped)`);

  let turns = 0;
  while (watch.turnCrown(0.05) > 1e-9 && turns < 60) turns += 0.05;
  console.log(`crown turns to full wind   ${pad(turns.toFixed(2), 6)}`);
  watch.advance(10);
  console.log(`after winding: ${watch.read().running ? 'running' : 'stopped'}  (expect running)`);

  const before = watch.trainSeconds;
  const shownBefore = watch.shown;
  watch.pullCrown(true);
  watch.turnCrown(5);
  watch.pullCrown(false);
  console.log(`setting moved the hands by ${pad(((watch.shown - shownBefore) / 60).toFixed(1), 6)} min`);
  console.log(`setting moved the train by ${pad((watch.trainSeconds - before).toFixed(4), 6)} s  (expect 0)`);
}

console.log('\n--- isochronism: does the rate care about the amplitude? ---');
console.log('  turns   amplitude    s/day');
for (const wind of [FULL_WIND, 3, 1.5, 0.6]) {
  const watch = wound(wind);
  watch.advance(SETTLE);
  const read = watch.read();
  if (!read.running) {
    console.log(`  ${pad(wind.toFixed(1), 5)}   stopped`);
    continue;
  }
  console.log(
    `  ${pad(wind.toFixed(1), 5)}   ${pad(read.amplitude.toFixed(0), 9)}   ${pad(read.rate.toFixed(3), 8)}`,
  );
}

console.log('\n--- the wrong mainspring ---');
console.log('  strength   amplitude   knocking     s/day');
for (const strength of [0.5, 1, 1.5, 2, 3]) {
  const watch = new Movement();
  watch.setMainspring(strength);
  watch.advance(SETTLE);
  const read = watch.read();
  console.log(
    `  ${pad(strength.toFixed(1) + '\u00d7', 8)}   ${pad(read.running ? read.amplitude.toFixed(0) : 'stopped', 9)}   ` +
      `${pad(read.knocking ? 'yes' : 'no', 8)}   ${pad(read.rate.toFixed(1), 7)}`,
  );
}

console.log('\n--- the regulator ---');
console.log('  index    s/day');
for (const index of [-1, -0.5, 0, 0.5, 1]) {
  const watch = new Movement();
  watch.setIndex(index);
  watch.advance(SETTLE);
  console.log(`  ${pad(index.toFixed(1), 5)}   ${pad(watch.read().rate.toFixed(1), 7)}`);
}

console.log('\n--- the rotor, against an empty barrel ---');
console.log('  activity               rotor rpm   turns/h into the arbor   spent/h   surplus');
for (const wrist of ACTIVITY) {
  const watch = new Movement();
  watch.letDown();
  watch.setWrist(wrist);
  // A minute of real integration, so the rotor is driven rather than sampled.
  watch.advance(60);
  const read = watch.read();
  const surplus = read.windingRate / (600 / TRAIN_RATIO);
  console.log(
    `  ${pad(wrist.label, 20)}   ${pad(read.rotorSpeed.toFixed(0), 9)}   ${pad(read.windingRate.toFixed(3), 22)}   ` +
      `${pad((600 / TRAIN_RATIO).toFixed(3), 7)}   ${pad(surplus.toFixed(1) + '\u00d7', 7)}`,
  );
}

console.log('\n--- the rotor, against a full barrel: can it still wind? ---');
console.log('  activity               rotor rpm   turns/h   vs empty');
for (const wrist of ACTIVITY) {
  const empty = new Movement();
  empty.letDown();
  empty.setWrist(wrist);
  empty.advance(60);

  const watch = new Movement();
  watch.fullWind();
  watch.setWrist(wrist);
  watch.advance(60);
  const read = watch.read();
  const ratio = empty.read().windingRate > 1e-6 ? read.windingRate / empty.read().windingRate : 1;
  console.log(
    `  ${pad(wrist.label, 20)}   ${pad(read.rotorSpeed.toFixed(0), 9)}   ${pad(read.windingRate.toFixed(3), 7)}   ` +
      `${pad((ratio * 100).toFixed(0) + '%', 8)}`,
  );
}

console.log('\n--- winding it from dead, on a wrist ---');
console.log('  activity               started    h to 200 deg   h to full   settles at');
for (const wrist of ACTIVITY) {
  const watch = new Movement();
  watch.letDown();
  watch.setWrist(wrist);
  let hours = 0;
  let full = -1;
  let healthy = -1;
  let started = -1;
  while (hours < 48 && full < 0) {
    watch.fastForward(300);
    hours += 1 / 12;
    const read = watch.read();
    if (started < 0 && read.running) started = hours;
    if (healthy < 0 && read.amplitude > 200) healthy = hours;
    if (read.wind > FULL_WIND - 0.02) full = hours;
  }
  const show = (h: number) => (h < 0 ? 'never' : h.toFixed(1) + ' h');
  console.log(
    `  ${pad(wrist.label, 20)}   ${pad(show(started), 7)}   ${pad(show(healthy), 12)}   ` +
      `${pad(show(full), 9)}   ${pad(watch.read().wind.toFixed(2) + ' turns', 12)}`,
  );
}

console.log('\n--- do the two integrators agree about the rotor? ---');
console.log('  activity               start   stepped   sampled    error');
for (const wrist of ACTIVITY) {
  for (const start of [0, 2, 5.4]) {
    const stepped = wound(start);
    stepped.setWrist(wrist);
    stepped.advance(120);

    const sampled = wound(start);
    sampled.setWrist(wrist);
    for (let i = 0; i < 4; i++) sampled.fastForward(30);

    const a = stepped.read().wind - start;
    const b = sampled.read().wind - start;
    const error = Math.abs(a) > 1e-4 ? `${(((b - a) / Math.abs(a)) * 100).toFixed(0)}%` : '—';
    console.log(
      `  ${pad(wrist.label, 20)}   ${pad(start.toFixed(1), 5)}   ${pad(a.toFixed(4), 7)}   ` +
        `${pad(b.toFixed(4), 7)}   ${pad(error, 6)}`,
    );
  }
}

console.log('\n--- the bridle: what happens when it is full and you keep walking ---');
{
  const watch = new Movement();
  watch.fullWind();
  watch.setWrist(ACTIVITY_BY_ID.get('walking')!);
  for (let hour = 0; hour < 8; hour++) watch.fastForward(3600);
  const read = watch.read();
  console.log(`after 8 h walking, wind    ${pad(read.wind.toFixed(3), 7)}  (cap ${FULL_WIND})`);
  console.log(`turns the bridle gave up   ${pad(read.slipped.toFixed(1), 7)}`);
  console.log(`slipping now               ${pad(read.slipping ? 'yes' : 'no', 7)}  (expect yes)`);
  console.log(`still running              ${pad(read.running ? 'yes' : 'no', 7)}  (expect yes)`);
  console.log(`amplitude                  ${pad(read.amplitude.toFixed(0), 7)} deg`);

  // And it has to stop saying so the moment the watch comes off the wrist, which a flag
  // set from the last step that happened to slip does not.
  watch.setWrist(ACTIVITY_BY_ID.get('off')!);
  watch.fastForward(600);
  console.log(`after 10 min on the table  ${pad(watch.read().slipping ? 'yes' : 'no', 7)}  (expect no)`);
}

console.log('\n--- taking it off: a day walking, then two days on the table ---');
{
  const watch = new Movement();
  watch.letDown();
  watch.setWrist(ACTIVITY_BY_ID.get('walking')!);
  for (let i = 0; i < 12; i++) watch.fastForward(3600);
  const worn = watch.read();
  console.log(`after 12 h on the wrist    wind ${pad(worn.wind.toFixed(2), 5)}   ${worn.running ? 'running' : 'stopped'}`);

  watch.setWrist(ACTIVITY_BY_ID.get('off')!);
  let hours = 12;
  while (watch.read().running && hours < 120) {
    watch.fastForward(1800);
    hours += 0.5;
  }
  console.log(`stopped after              ${pad((hours - 12).toFixed(1), 5)} h on the table`);
}

console.log('\n--- the reduction ---');
{
  console.log(`rotor turns per arbor turn  ${pad(AUTO_RATIO.toFixed(0), 6)}`);
  console.log(`rotor turns for a full wind ${pad((AUTO_RATIO * FULL_WIND).toFixed(0), 6)}`);
  const load = 2.3e-3 / (AUTO_RATIO * 0.55);
  console.log(`load at the rotor, full     ${pad((load * 1e6).toFixed(0), 6)} \u00b5N\u00b7m`);
  console.log(`gravity torque at 1 g       ${pad((2.4e-5 * 9.81 * 1e6).toFixed(0), 6)} \u00b5N\u00b7m`);
  console.log(`margin                      ${pad(((2.4e-5 * 9.81) / load).toFixed(1), 6)}\u00d7`);
}
