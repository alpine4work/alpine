/**
 * Same as `Object.entries()` but the key type is `keyof Object` instead of
 * `string`. This is unsound! Since object types in TypeScript:
 *
 * - Do not need to include every key in the object
 * - May include non-own keys (keys from a prototype of the object)
 *
 * Use this only if you know the TypeScript type declares all keys of the
 * object.
 */
export const getObjectEntriesWithKeyofType = Object.entries as <
    Key extends string | number,
    Value,
>(object: {[_Key in Key]?: Value}) => Array<[Key, Value]>;
