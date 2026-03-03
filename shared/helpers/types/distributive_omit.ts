/**
 * `Omit<T, K>` but it distributes across a union. So `DistributiveOmit<A | B | C>`
 * becomes `Omit<A, K> | Omit<B, K> | Omit<C, K>` as opposed to
 * `Omit<A | B | C, K>`.
 */
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
