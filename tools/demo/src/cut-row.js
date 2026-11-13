/*
 * Feature Lab "Cut moves" row: how it reads for the file on screen, the same way the Retraction markers row
 * does. `hasCut` is true/false for a loaded file and null when no file is on screen; `ready` is whether the
 * viewer can take controls. Pure (no DOM), so the wording is unit-tested in Node.
 */
export const CUT_LABEL = 'Cut moves';
export const CUT_LABEL_NONE = 'Cut moves — none in this file';

export function cutRowState(hasCut, ready) {
  if (ready && hasCut === false) return { label: CUT_LABEL_NONE, disabled: true };
  // Not ready (nothing loaded, or loading): disabled like every runtime control, plain label.
  return { label: CUT_LABEL, disabled: !ready };
}
