import {TypedFastBitSet} from "typedfastbitset";
import {BitsetSchema} from "~/shared/schema/bitset_schema.js";
import {Schema} from "~/shared/schema/schema.open_source.js";

test("round-trips an empty bitset as no bytes", () => {
    const serialized = BitsetSchema.serialize(new TypedFastBitSet());
    const bytes = Schema.bytes.deserialize(serialized);

    expect({
        bytes: Array.from(bytes),
        values: BitsetSchema.deserialize(serialized).array(),
    }).toEqual({
        bytes: [],
        values: [],
    });
});

test("round-trips a dense bitset and trims trailing zero words", () => {
    const bitset = new TypedFastBitSet();
    bitset.addRange(0, 64);
    bitset.add(95);
    bitset.removeRange(32, 96);

    const serialized = BitsetSchema.serialize(bitset);
    const bytes = Schema.bytes.deserialize(serialized);

    expect({
        byteLength: bytes.length,
        values: BitsetSchema.deserialize(serialized).array(),
    }).toEqual({byteLength: 4, values: Array.from({length: 32}, (_, index) => index)});
});

test("uses unsigned little-endian words", () => {
    const bitset = new TypedFastBitSet([0, 8, 31, 32]);

    expect(Array.from(Schema.bytes.deserialize(BitsetSchema.serialize(bitset)))).toEqual([
        0x01, 0x01, 0x00, 0x80, 0x01, 0x00, 0x00, 0x00,
    ]);
});

test("serialized bytes are independent from later bitset mutations", () => {
    const bitset = new TypedFastBitSet([0]);
    const serialized = BitsetSchema.serialize(bitset);

    bitset.add(1);

    expect(Array.from(Schema.bytes.deserialize(serialized))).toEqual([1, 0, 0, 0]);
});

test("deserializes an unaligned byte view", () => {
    const source = new Uint8Array([255, 1, 0, 0, 0]);
    const bytes = source.subarray(1);
    const bitset = BitsetSchema.deserialize(Schema.bytes.serialize(bytes));

    expect(bitset.array()).toEqual([0]);
});

test("deserialized bitset is independent from later byte mutations", () => {
    const bytes = new Uint8Array([1, 0, 0, 0]);
    const bitset = BitsetSchema.deserialize(Schema.bytes.serialize(bytes));

    bytes[0] = 0;

    expect(bitset.array()).toEqual([0]);
});

test("round-trips the maximum SQLite page index", () => {
    const maximumPageIndex = 262_143;
    const serialized = BitsetSchema.serialize(new TypedFastBitSet([maximumPageIndex]));
    const bytes = Schema.bytes.deserialize(serialized);

    expect({
        byteLength: bytes.length,
        hasMaximum: BitsetSchema.deserialize(serialized).has(maximumPageIndex),
    }).toEqual({byteLength: 32 * 1024, hasMaximum: true});
});

test("rejects an incomplete word", () => {
    expect(() => BitsetSchema.deserialize(Schema.bytes.serialize(new Uint8Array([1])))).toThrow(
        "Expected bitset bytes to contain complete 32-bit words",
    );
});
