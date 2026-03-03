/**
 * Escape a string so it can be used in a regular expression. Derived from
 * [StackOverflow][1].
 *
 * [1]:
 *     https://stackoverflow.com/questions/3115150/how-to-escape-regular-expression-special-characters-using-javascript
 */
export function escapeRegExp(string: string) {
    return string.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
