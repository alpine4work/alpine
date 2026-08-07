/**
 * Empty read-only array constant.
 *
 * You can use this if you want a referentially equal empty array to pass around
 * places that depend on referential equality (like React).
 */
export const emptyArray: ReadonlyArray<never> = Object.freeze([]);
