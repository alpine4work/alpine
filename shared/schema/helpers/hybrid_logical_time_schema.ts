import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Schema} from "~/shared/schema/schema.js";

const higherBitsMask = 2n ** 48n - 1n;
const lowerBitsMask = 2n ** 16n - 1n;

// Hybrid logical times were designed to fit in a 64-bit integer. With ticks as the
// 16 lower bits and time as the 48 higher bits.
export const HybridLogicalTimeSchema = Schema.uint64.transform<HybridLogicalTime>({
    serialize: serializeHybridLogicalTime,
    deserialize: deserializeHybridLogicalTime,
});

export function serializeHybridLogicalTime([time, ticks]: HybridLogicalTime): bigint {
    assert(Number.isInteger(time));
    assert(0 <= time && time <= higherBitsMask);

    assert(Number.isInteger(ticks));
    assert(0 <= ticks && ticks <= lowerBitsMask);

    return ((BigInt(time) & higherBitsMask) << 16n) | (BigInt(ticks) & lowerBitsMask);
}

export function deserializeHybridLogicalTime(time: bigint): HybridLogicalTime {
    return [Number(time >> 16n), Number(time & lowerBitsMask)];
}
