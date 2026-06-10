/**
 * `keyof T` but it distributes across a union. So `DistributiveKeyOf<A | B | C>`
 * becomes `(keyof A) | (keyof B) | (keyof C)` as opposed to `keyof (A | B | C)`
 * which is the equivalent of `(keyof A) & (keyof B) & (keyof C)`.
 */
export type DistributiveKeyOf<T> = T extends unknown ? keyof T : never;
