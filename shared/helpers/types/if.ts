/**
 * TypeScript `if` condition. If the condition is true then we use the `True`
 * type. Otherwise we use the `False` type.
 */
export type If<Condition extends boolean, True, False> = Condition extends true
    ? True
    : Condition extends false
      ? False
      : never;
