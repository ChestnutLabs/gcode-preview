/**
 * Pure helpers for the capture harness (no browser, so they are unit-tested in `stabilize.test.mjs`).
 *
 * The Feature Lab re-applies its own colour mode, theme and layer range on every `buildComplete`, so a
 * shot's settings can be clobbered by a rebuild that the settings themselves trigger. These helpers make
 * the harness converge instead of hoping one settle was enough.
 */

/**
 * Apply the shot's settings, wait for the build to go quiet, and repeat until a whole apply+settle round
 * fires no further build (so nothing re-applied the Lab's own state over ours). Throws when the builds
 * never stop within `maxRounds`. Returns the number of rounds used.
 *
 * @param {{ apply: () => Promise<unknown>, builds: () => Promise<number>, settle: () => Promise<unknown>, maxRounds?: number }} io
 */
export async function applyUntilStable({ apply, builds, settle, maxRounds = 6 }) {
  for (let round = 1; round <= maxRounds; round++) {
    const before = await builds();
    await apply();
    await settle();
    if ((await builds()) === before) return round;
  }
  throw new Error(`settings did not stabilise after ${maxRounds} rounds (builds kept firing)`);
}

/**
 * Compare what the shot expects against the last value any caller wrote through the controller
 * (`ledger`). Returns one human-readable line per mismatch; an empty array means every expected key
 * holds. Values compare as JSON.
 *
 * @param {Record<string, unknown>} ledger
 * @param {Record<string, unknown>} expected
 * @returns {string[]}
 */
export function diffApplied(ledger, expected) {
  const out = [];
  for (const key of Object.keys(expected)) {
    const want = JSON.stringify(expected[key]);
    const got = JSON.stringify(ledger[key]);
    if (want !== got) out.push(`${key}: expected ${want}, controller last received ${got}`);
  }
  return out;
}

/**
 * Group shots whose output files are byte-identical. Two different shots must never render the same
 * pixels: that means a setting was lost. Returns one array of shot names per duplicate group.
 *
 * @param {{ name: string, hash: string }[]} entries
 * @returns {string[][]}
 */
export function findDuplicateImages(entries) {
  const byHash = new Map();
  for (const { name, hash } of entries) {
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(name);
  }
  return [...byHash.values()].filter((names) => names.length > 1);
}
