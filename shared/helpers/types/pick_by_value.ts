/**
 * From `T` pick a set of properties by value matching `U`.
 *
 * So `PickByValue<{a: number, b: string, c: number}, number>` is
 * `{a: number, c: number}`.
 *
 * Credit:
 * [Piotr Lewandowski](https://medium.com/dailyjs/typescript-create-a-condition-based-subset-types-9d902cea5b8c)
 */
export type PickByValue<T, U> = Pick<
    T,
    {[Key in keyof T]-?: T[Key] extends U ? Key : never}[keyof T]
>;
