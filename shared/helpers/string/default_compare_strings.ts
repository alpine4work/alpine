/**
 * Compare two strings using the default JavaScript string order used by
 * [operators][1] and [array sorts][2]. That is compare UTF-16 code units.
 *
 * If you're ordering user input strings then `String.localeCompare()` should be
 * used instead so you order based on the rules of the user's language instead of
 * an arbitrary technical implementation.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Less_than
 * [2]:
 *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
 * [3]:
 *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
 */
export function defaultCompareStrings(string1: string, string2: string): -1 | 0 | 1 {
    if (string1 < string2) return -1;
    if (string1 > string2) return 1;
    return 0;
}
