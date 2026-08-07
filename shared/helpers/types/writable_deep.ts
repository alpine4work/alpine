import {JsonScalarValue} from "~/shared/helpers/types/json_value.open_source.js";

/**
 * Deeply converts a type into a writable type. The inverse of `ReadonlyDeep`.
 *
 * Supports:
 *
 * - Arrays
 * - Sets
 * - Maps
 * - Objects
 */
export type WritableDeep<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? Array<WritableDeep<Item>>
      : Value extends ReadonlySet<infer Item>
        ? Set<WritableDeep<Item>>
        : Value extends ReadonlyMap<infer Key, infer Value>
          ? Map<Key, WritableDeep<Value>>
          : Value extends object
            ? {-readonly [Key in keyof Value]: WritableDeep<Value[Key]>}
            : Value;

/**
 * Shallowly converts a type into a writable type. The inverse of
 * `ReadonlyShallow`.
 *
 * Supports:
 *
 * - Arrays
 * - Sets
 * - Maps
 * - Objects
 */
export type WritableShallow<Value> = Value extends JsonScalarValue | undefined
    ? Value
    : Value extends ReadonlyArray<infer Item>
      ? Array<Item>
      : Value extends ReadonlySet<infer Item>
        ? Set<Item>
        : Value extends ReadonlyMap<infer Key, infer Value>
          ? Map<Key, Value>
          : Value extends object
            ? {-readonly [Key in keyof Value]: Value[Key]}
            : Value;
