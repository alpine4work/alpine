/**
 * The minimum number of characters that should be identical to a name in our
 * Fuse.js account name index to consider a match valid. If there's a name in the
 * index that's shorter than this length (e.g. the short name "Vu" of "Vu Tran")
 * then an exact match should be considered valid.
 *
 * Setting a minimum matching character length is important since we use the index
 * for natural language parsing. If the user types "by e" we don't want that to be
 * parsed as "by emily". Instead we want to do a keyword search.
 */
export const accountNameIndexFuseMinMatchCharLength = 4;

/**
 * If we have a Fuse.js score below this when parsing a name then we consider the
 * name a match.
 *
 * We maintain a stricter score cutoff than Fuse.js since we use our index for name
 * parsing in natural language instead of in an autocomplete. That means we need to
 * demand a higher level of correctness.
 */
export const accountNameIndexFuseScoreMatchCutoff = 0.35;
