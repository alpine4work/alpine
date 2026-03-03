/**
 * Empty read-only object constant.
 *
 * You can use this if you want a referentially equal empty object to pass around
 * places that depend on referential equality (like React).
 */
export const emptyObject: {[key: string]: undefined} = Object.freeze({});
