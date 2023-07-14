import {compareAsc} from "date-fns";
import jsonStableStringify from "json-stable-stringify";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {Schema} from "~/shared/schema/schema.js";

export type CrdtRegisterClass<Value> = {
    new (value: Value, updatedTime: Date): CrdtRegister<Value>;
    readonly schema: Schema<CrdtRegister<Value>>;
    readonly actionSchema: Schema<CrdtRegisterAction<Value>>;
};

export interface CrdtRegister<Value> {
    readonly value: Value;
    readonly updatedTime: Date;

    /**
     * Merges two registers and picks a winner. This method is commutative and
     * idempotent.
     *
     * In the rare case we have an `updatedTime` conflict we will arbitrarily pick
     * one of the registers as the winner. Which winner we pick isn't predictable
     * but all clients will consistently pick the same winner.
     */
    merge(other: CrdtRegister<Value>): CrdtRegister<Value>;

    /**
     * Creates an action you can apply with `apply()` that updates this
     * register's value.
     */
    set(value: Value): CrdtRegisterAction<Value>;

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
    readonly updatedTime: Date;
};

type CrdtRegisterInterface<Value> = CrdtRegister<Value>;

/**
 * Creates a simple register [CRDT][1] class.
 *
 * Registers implement last-write-wins semantics. The write with the highest
 * `updatedTime` is always the latest value.
 *
 * We recommend validating that `updatedTime` isn't too far in the future when
 * you receive a `CrdtRegister` update. That way an attacker can't set a crazy
 * `updatedTime`.
 *
 * We could use a Lamport timestamp which is a tuple of `(counter, clientId)`
 * instead of `updatedTime` (similar to what's described in “[A Conflict-Free
 * Replicated JSON Datatype][2]”). We chose `updatedTime` because:
 *
 * 1. It carries some potentially useful semantic meaning (the time the
 *    register was updated).
 * 2. We don't have to bother assigning `clientId`s.
 *
 * [1]: https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type
 * [2]: https://arxiv.org/pdf/1608.03960.pdf
 */
export function createCrdtRegister<Value>(valueSchema: Schema<Value>): CrdtRegisterClass<Value> {
    return class CrdtRegister implements CrdtRegisterInterface<Value> {
        public readonly value: Value;
        public readonly updatedTime: Date;

        constructor(value: Value, updatedTime: Date) {
            this.value = value;
            this.updatedTime = updatedTime;
        }

        public static readonly schema: Schema<CrdtRegister> = Schema.object({
            value: valueSchema as Schema<any>,
            updatedTime: Schema.date,
        }).transform<CrdtRegister>({
            serialize: register => register,
            deserialize: register => new CrdtRegister(register.value, register.updatedTime),
        });

        public static readonly actionSchema: Schema<CrdtRegisterAction<Value>> = Schema.object({
            value: valueSchema as Schema<any>,
            updatedTime: Schema.date,
        });

        public merge(other: CrdtRegister): CrdtRegister {
            const comparison = compareAsc(this.updatedTime, other.updatedTime);
            if (comparison > 0) return this;
            if (comparison < 0) return other;

            // Getting an `updatedTime` conflict should be rare. In this case, fallback
            // to the values' structural order. All that matters is the decision is
            // consistent, since `updatedTime` conflict should be rare we don't really care
            // about which value wins. Only that the same value wins every time.
            const fallbackComparison = defaultCompareStrings(
                jsonStableStringify(valueSchema.serialize(this.value)),
                jsonStableStringify(valueSchema.serialize(other.value)),
            );
            if (fallbackComparison > 0) return this;
            if (fallbackComparison < 0) return other;
            return this;
        }

        public set(value: Value): CrdtRegisterAction<Value> {
            // TODO(calebmer): Maybe we should use the same NTP synchronized time we use
            // for our tracer to deal with client clock offsets?
            const updatedTime = new Date(Math.max(Date.now(), this.updatedTime.getTime() + 1));

            return {value, updatedTime};
        }

        public apply(action: CrdtRegisterAction<Value>): CrdtRegister {
            return this.merge(new CrdtRegister(action.value, action.updatedTime));
        }
    };
}
