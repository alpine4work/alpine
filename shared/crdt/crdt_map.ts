import {CrdtRegister, createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export type CrdtMapClass<Key extends string | number, Value extends {}> = {
    readonly empty: CrdtMap<Key, Value>;
    readonly schema: Schema<CrdtMap<Key, Value>>;
    readonly actionSchema: Schema<CrdtMapAction<Key, Value>>;
};

export interface CrdtMap<Key extends string | number, Value extends {}> {
    /**
     * Gets the value for the specified key or `undefined` if the value does not
     * exist in the map.
     */
    get(key: Key): Value | undefined;

    /**
     * Is there an entry for this key in the map?
     */
    has(key: Key): boolean;

    /**
     * Returns a new iterator of all the keys in the map.
     *
     * Iterates in key order, not insertion order.
     */
    keys(): IterableIterator<Key>;

    /**
     * Returns a new iterator of all the values in the map.
     *
     * Iterates in key order, not insertion order.
     */
    values(): IterableIterator<Value>;

    /**
     * Returns a new iterator of all the entries in the map.
     *
     * Iterates in key order, not insertion order.
     */
    entries(): IterableIterator<[Key, Value]>;

    /**
     * Returns a new iterator of all the entires in the map with the `version`
     * of their registers.
     */
    entriesWithVersion(): IterableIterator<[Key, {value: Value; version: HybridLogicalTime}]>;

    /**
     * Returns a new iterator of all the entries in the map.
     *
     * Iterates in key order, not insertion order.
     */
    [Symbol.iterator](): IterableIterator<[Key, Value]>;

    /**
     * Merges two maps together. This method is commutative and idempotent. Maps
     * will converge to the correct state.
     */
    merge(other: CrdtMap<Key, Value>): CrdtMap<Key, Value>;

    /**
     * Creates an action that sets a key in our map to the provided value. You can
     * apply the action with `apply()`.
     */
    set(clock: HybridLogicalClock, key: Key, value: Value): CrdtMapAction<Key, Value>;

    /**
     * Creates an action that removes a key from our map. You can apply the action
     * with `apply()`.
     */
    delete(clock: HybridLogicalClock, key: Key): CrdtMapAction<Key, Value>;

    /**
     * Applies an action to our map. This method is commutative and idempotent.
     */
    apply(action: CrdtMapAction<Key, Value>): CrdtMap<Key, Value>;
}

/**
 * An action that updates a `CrdtMap`. Applying an action is commutative and
 * idempotent.
 */
export type CrdtMapAction<Key extends string | number, Value extends {}> =
    | {
          readonly type: "Set";
          readonly key: Key;
          readonly value: Value;
          readonly version: HybridLogicalTime;
      }
    | {
          readonly type: "Delete";
          readonly key: Key;
          readonly version: HybridLogicalTime;
      };

type CrdtMapInterface<Key extends string | number, Value extends {}> = CrdtMap<Key, Value>;

/**
 * Creates a simple map [CRDT][1] class.
 *
 * When you delete items from the map it leaves a gravestone. So the key will
 * still exist in the map but the key will not be observable when you call
 * `get()` or `entries()` or any other method to inspect the map.
 *
 * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 */
export function createCrdtMap<Key extends string | number, Value extends {}>(
    keySchema: Schema<Key>,
    valueSchema: Schema<Value>,
): CrdtMapClass<Key, Value> {
    const CrdtMapValueRegister = createCrdtRegister<Value | null>(valueSchema.nullable());

    return class CrdtMap implements CrdtMapInterface<Key, Value> {
        private readonly _map: ImmutableMap<Key, CrdtRegister<Value | null>>;

        private constructor(map: ImmutableMap<Key, CrdtRegister<Value | null>>) {
            this._map = map;
        }

        public static empty = new CrdtMap(ImmutableMap.empty());

        public static readonly schema = Schema.map(
            keySchema,
            CrdtMapValueRegister.schema,
        ).transform<CrdtMapInterface<Key, Value>>({
            serialize: map => new Map((map as CrdtMap)._map),
            deserialize: map => new CrdtMap(ImmutableMap.from(map)),
        });

        public static readonly actionSchema: Schema<CrdtMapAction<Key, Value>> = Schema.union({
            Set: Schema.object({
                type: Schema.value("Set"),
                key: keySchema as Schema<any>,
                value: valueSchema as Schema<any>,
                version: HybridLogicalTimeSchema,
            }),
            Delete: Schema.object({
                type: Schema.value("Delete"),
                key: keySchema as Schema<any>,
                version: HybridLogicalTimeSchema,
            }),
        });

        public get(key: Key): Value | undefined {
            return this._map.get(key)?.value ?? undefined;
        }

        public has(key: Key): boolean {
            return this.get(key) !== undefined;
        }

        public *keys(): IterableIterator<Key> {
            for (const [key, {value}] of this._map.entries()) {
                if (value !== null) {
                    yield key;
                }
            }
        }

        public *values(): IterableIterator<Value> {
            for (const [, {value}] of this._map.entries()) {
                if (value !== null) {
                    yield value;
                }
            }
        }

        public *entries(): IterableIterator<[Key, Value]> {
            for (const [key, {value}] of this._map.entries()) {
                if (value !== null) {
                    yield [key, value];
                }
            }
        }

        public *entriesWithVersion(): IterableIterator<
            [Key, {value: Value; version: HybridLogicalTime}]
        > {
            for (const [key, {value, version}] of this._map.entries()) {
                if (value !== null) {
                    yield [key, {value, version}];
                }
            }
        }

        public [Symbol.iterator](): IterableIterator<[Key, Value]> {
            return this.entries();
        }

        public merge(other: CrdtMap): CrdtMap {
            let newMap = this._map;

            for (const [otherKey, otherValueRegister] of other._map) {
                newMap = newMap.update(otherKey, valueRegister => {
                    if (valueRegister === undefined) return otherValueRegister;
                    return valueRegister.merge(otherValueRegister);
                });
            }

            return new CrdtMap(newMap);
        }

        public set(clock: HybridLogicalClock, key: Key, value: Value): CrdtMapAction<Key, Value> {
            const lastVersion = this._map.get(key)?.version;

            return {
                type: "Set",
                key,
                value,
                version: lastVersion ? clock.tick(lastVersion) : clock.now(),
            };
        }

        public delete(clock: HybridLogicalClock, key: Key): CrdtMapAction<Key, Value> {
            const lastVersion = this._map.get(key)?.version;

            return {
                type: "Delete",
                key,
                version: lastVersion ? clock.tick(lastVersion) : clock.now(),
            };
        }

        public apply(action: CrdtMapAction<Key, Value>): CrdtMap {
            switch (action.type) {
                case "Set": {
                    const newValueRegister = new CrdtMapValueRegister(action.value, action.version);

                    const newMap = this._map.update(action.key, valueRegister => {
                        if (valueRegister === undefined) return newValueRegister;
                        return valueRegister.merge(newValueRegister);
                    });

                    // Optimization: If the map didn't change, return the old reference.
                    if (newMap === this._map) return this;

                    return new CrdtMap(newMap);
                }
                case "Delete": {
                    const newValueRegister = new CrdtMapValueRegister(null, action.version);

                    const newMap = this._map.update(action.key, valueRegister => {
                        if (valueRegister === undefined) return newValueRegister;
                        return valueRegister.merge(newValueRegister);
                    });

                    // Optimization: If the map didn't change, return the old reference.
                    if (newMap === this._map) return this;

                    return new CrdtMap(newMap);
                }
                default:
                    throw exhaustive(action);
            }
        }
    };
}
