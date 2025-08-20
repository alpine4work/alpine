/**
 * `Partial<T>` but only for the keys in `K`.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
