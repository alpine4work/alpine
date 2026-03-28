import {JsonScalarValue} from "~/shared/helpers/types/json_value.js";

/**
 * Deeply converts a type into a readonly type. The inverse of `WritableDeep`.
 *
 * Supports:
 *
 * - Arrays
 * - Sets
 * - Maps
 * - Objects
 */
export type ReadonlyDeep<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? ReadonlyArray<ReadonlyDeep<Item>>
      : Value extends ReadonlySet<infer Item>
        ? ReadonlySet<ReadonlyDeep<Item>>
        : Value extends ReadonlyMap<infer Key, infer Value>
          ? ReadonlyMap<Key, ReadonlyDeep<Value>>
          : Value extends object
            ? {readonly [Key in keyof Value]: ReadonlyDeep<Value[Key]>}
            : Value;

/**
 * Shallowly converts a type into a readonly type. The inverse of
 * `WritableShallow`. Very similar to the built-in TypeScript `Readonly` type but
 * supports more than just objects.
 *
 * Supports:
 *
 * - Arrays
 * - Sets
 * - Maps
 * - Objects
 */
export type ReadonlyShallow<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? ReadonlyArray<Item>
      : Value extends ReadonlySet<infer Item>
        ? ReadonlySet<Item>
        : Value extends ReadonlyMap<infer Key, infer Value>
          ? ReadonlyMap<Key, Value>
          : Value extends object
            ? {readonly [Key in keyof Value]: Value[Key]}
            : Value;
