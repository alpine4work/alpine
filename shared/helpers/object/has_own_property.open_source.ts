/**
 * [`Object.prototype.hasOwnProperty`][1] except not attached to a prototype so you
 * can call it on objects that override the method or on objects with a null
 * prototype.
 *
 * Also provides a convenient TypeScript type.
 *
 * [1]:
 *     https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/hasOwnProperty
 */
export function hasOwnProperty<K extends string | number | symbol>(
    object: unknown,
    key: K,
): object is {[_K in K]: unknown} {
    return Object.prototype.hasOwnProperty.call(object, key);
}
