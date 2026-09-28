/**
 * Scratch harness. Runs the movement with no browser attached and prints the things that
 * are supposed to fall out of it: the beat rate, the amplitude at each state of wind, the
 * power reserve, and whether the hands agree with the clock. Not part of the site build.
 *
 *   ./run.sh
 */
import { BEATS_PER_HOUR, FULL_WIND, Movement, settledAmplitude, escapeTorque, DEG } from './movement';

/** Long enough for the amplitude to settle: it climbs with a time constant near a minute. */
const SETTLE = 240;

function pad(text: string | number, width: number): string {
  return String(text).padStart(width);
}

function wound(turns: number): Movement {
  const watch = new Movement();
  watch.letDown();
  watch.turnCrown(turns / (14 / 36));
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
