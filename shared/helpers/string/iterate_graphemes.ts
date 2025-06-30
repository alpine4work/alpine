import GraphemeSplitter from "grapheme-splitter";

const graphemeSplitter = new GraphemeSplitter();

/**
 * Iterate through Unicode graphemes. Provides a nicer interface to
 * [`grapheme-splitter`][1].
 *
 * [1]: https://www.npmjs.com/package/grapheme-splitter
 */
export function iterateGraphemes(string: string): IterableIterator<string> {
    return graphemeSplitter.iterateGraphemes(string);
}

/**
 * Split apart Unicode graphemes. Provides a nicer interface to
 * [`grapheme-splitter`][1].
 *
 * [1]: https://www.npmjs.com/package/grapheme-splitter
 */
export function splitGraphemes(string: string): Array<string> {
    return graphemeSplitter.splitGraphemes(string);
}

/**
 * Count Unicode graphemes. Provides a nicer interface to
 * [`grapheme-splitter`][1].
 *
 * [1]: https://www.npmjs.com/package/grapheme-splitter
 */
export function countGraphemes(string: string): number {
    return graphemeSplitter.countGraphemes(string);
}
