import jsonStableStringify from "json-stable-stringify";
import {
    HybridLogicalClock,
    HybridLogicalTime,
    compareHybridLogicalTimes,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export type CrdtRegisterClass<Value> = {
    new (value: Value, version: HybridLogicalTime): CrdtRegister<Value>;
    readonly schema: Schema<CrdtRegister<Value>>;
    readonly actionSchema: Schema<CrdtRegisterAction<Value>>;
};

export interface CrdtRegister<Value> {
    readonly value: Value;
    readonly version: HybridLogicalTime;

    /**
     * Merges two registers and picks a winner. This method is commutative and
     * idempotent.
     *
     * In the rare case we have an `version` conflict we will arbitrarily pick one of
     * the registers as the winner. Which winner we pick isn't predictable but all
     * clients will consistently pick the same winner.
     */
    merge(other: CrdtRegister<Value>): CrdtRegister<Value>;

    /**
     * Is this CRDT register equal to the other one?
     */
    isEqual(other: CrdtRegister<Value>): boolean;

    /**
     * Creates an action you can apply with `apply()` that updates this register's
     * value.
     */
    set(clock: HybridLogicalClock, value: Value): CrdtRegisterAction<Value>;

    /**
     * Apply a register action. This method is commutative and idempotent.
     */
    apply(action: CrdtRegisterAction<Value>): CrdtRegister<Value>;
}

/**
 * An action that updates a `CrdtRegister`. Applying an action is commutative and
 * idempotent.
 */
export type CrdtRegisterAction<Value> = {
    readonly value: Value;
    readonly version: HybridLogicalTime;
};

type CrdtRegisterInterface<Value> = CrdtRegister<Value>;

/**
 * Creates a simple register [CRDT][1] class.
 *
 * Registers implement last-write-wins semantics. The write with the highest `time`
 * (which is a `HybridLogicalTime`) is always the latest value.
 *
 * We recommend validating that `time` isn't too far in the future when you receive
 * a `CrdtRegister` update. That way an attacker can't set a crazy time.
 *
 * We could use a Lamport timestamp which is a tuple of `(counter, clientId)`
 * instead of `HybridLogicalTime` (similar to what's described in "[A Conflict-Free
 * Replicated JSON Datatype][2]"). We chose `HybridLogicalTime` because:
 *
 * 1. It carries some potentially useful semantic meaning (the time the register
 *    was updated).
 * 2. We don't have to bother assigning `clientId`s.
 *
 * The user may pass in a custom `merge` function for merging two registers whose
 * versions are identical. If you provide a custom `merge` function then you must
 * be careful to make sure your custom `merge` function is commutative and
 * idempotent.
 *
 * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 * [2]: https://arxiv.org/pdf/1608.03960.pdf
 */
export function createCrdtRegister<Value>(
    valueSchema: Schema<Value>,
    {merge}: {merge?: (value1: Value, value2: Value) => Value} = {},
): CrdtRegisterClass<Value> {
    return class CrdtRegister implements CrdtRegisterInterface<Value> {
        public readonly value: Value;
        public readonly version: HybridLogicalTime;

        constructor(value: Value, version: HybridLogicalTime) {
            this.value = value;
            this.version = version;
        }

        public static readonly schema: Schema<CrdtRegister> = Schema.object({
            value: valueSchema as Schema<any>,
            version: HybridLogicalTimeSchema,
        }).transform<CrdtRegister>({
            serialize: register => register,
            deserialize: register => new CrdtRegister(register.value, register.version),
        });

        public static readonly actionSchema: Schema<CrdtRegisterAction<Value>> = Schema.object({
            value: valueSchema as Schema<any>,
            version: HybridLogicalTimeSchema,
        });

        public merge(other: CrdtRegister): CrdtRegister {
            const comparison = compareHybridLogicalTimes(this.version, other.version);
            if (comparison > 0) return this;
            if (comparison < 0) return other;

            // If the user specified a custom merge function then run that when we have a
            // version conflict.
            if (merge !== undefined) {
                const value = merge(this.value, other.value);
                if (Object.is(value, this.value)) return this;
                if (Object.is(value, other.value)) return other;
                return new CrdtRegister(value, this.version);
            }

            // Getting a `version` conflict should be rare. In this case, fallback to the
            // values' structural order. All that matters is the decision is consistent, since
            // `version` conflict should be rare we don't really care about which value wins.
            // Only that the same value wins every time.
            const fallbackComparison = defaultCompareStrings(
                jsonStableStringify(valueSchema.serialize(this.value)),
                jsonStableStringify(valueSchema.serialize(other.value)),
            );
            if (fallbackComparison > 0) return this;
            if (fallbackComparison < 0) return other;
            return this;
        }

        public isEqual(other: CrdtRegister): boolean {
            const comparison = compareHybridLogicalTimes(this.version, other.version);
            if (comparison !== 0) return false;

            // Getting a `version` conflict should be rare. In this case, fallback to the
            // values' structural order. All that matters is the decision is consistent, since
            // `version` conflict should be rare we don't really care about which value wins.
            // Only that the same value wins every time.
            return isDeepEqual(
                valueSchema.serialize(this.value),
                valueSchema.serialize(other.value),
            );
        }

        public set(clock: HybridLogicalClock, value: Value): CrdtRegisterAction<Value> {
            return {value, version: clock.tickNow(this.version)};
        }

        public apply(action: CrdtRegisterAction<Value>): CrdtRegister {
            return this.merge(new CrdtRegister(action.value, action.version));
        }
    };
}
