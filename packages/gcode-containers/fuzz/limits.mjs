/*
 * DD-008 D7 (#131): tight limits for fuzzing. Small enough that the fuzzer
 * reaches every limit-enforcement path quickly and no input can allocate
 * meaningfully, while exercising exactly the same code as production defaults.
 */
export const FUZZ_LIMITS = {
  maxEntries: 64,
  maxEntryNameBytes: 256,
  maxExpandedBytesPerEntry: 1 * 1024 * 1024,
  maxExpandedBytesTotal: 4 * 1024 * 1024,
  maxMetadataBytes: 256 * 1024
};

export const FUZZ_STREAM_CAP = 1 * 1024 * 1024;
