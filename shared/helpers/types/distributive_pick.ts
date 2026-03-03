/**
 * `Pick<T, K>` but it distributes across a union. So `DistributivePick<A | B | C>`
 * becomes `Pick<A, K> | Pick<B, K> | Pick<C, K>` as opposed to
 * `Pick<A | B | C, K>`.
 */
export type DistributivePick<T, K extends keyof T> = T extends unknown ? Pick<T, K> : never;
