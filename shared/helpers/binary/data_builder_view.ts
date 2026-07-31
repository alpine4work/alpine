import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

/**
 * Shared interface between `DataView` and `DataBuilderView`.
 */
export interface DataViewInterface {
    readonly byteOffset: number;
    readonly byteLength: number;

    getUint8(byteOffset: number): number;
    setUint8(byteOffset: number, value: number): void;
    getBigUint64(byteOffset: number, littleEndian?: boolean): bigint;
    setBigUint64(byteOffset: number, value: bigint, littleEndian?: boolean): void;
}

assertAssignableTypes<DataView, DataViewInterface>();

/**
 * Useful for building some unknown binary data using the same interface as
 * `DataView` when the length of the binary data is initially unknown.
 *
 * Implements `DataViewInterface` which is a subset of `DataView`. In addition to
 * functions like `setUint8()` we also have `pushUint8()` which grow the underlying
 * binary data.
 *
 * The naming logic for this class is `DataView` is a "view" of "data" whereas
 * `DataBuilderView` is a "view" of a "data builder".
 *
 * This is likely only fast for small amounts of binary data since it's backed by
 * an array of numbers. If you want to build large amounts of binary data, consider
 * a resizable `ArrayBuffer`.
 */
export class DataBuilderView implements DataViewInterface {
    readonly #bytes: Array<number>;

    constructor(bytes?: ArrayLike<number>) {
        this.#bytes = bytes !== undefined ? Array.from(bytes) : [];
    }

    get byteOffset(): number {
        return 0;
    }

    get byteLength(): number {
        return this.#bytes.length;
    }

    get bytes(): ReadonlyArray<number> {
        return this.#bytes;
    }

    build(): Uint8Array {
        return new Uint8Array(this.#bytes);
    }

    getUint8(byteOffset: number): number {
        const byteIndex = Number.isNaN(byteOffset) ? 0 : Math.trunc(byteOffset);

        if (!Number.isSafeInteger(byteIndex) || byteIndex < 0 || byteIndex >= this.#bytes.length) {
            throw new RangeError("Offset is outside the bounds of the DataView");
        }

        return this.#bytes[byteIndex]!;
    }

    setUint8(byteOffset: number, value: number): void {
        const byteIndex = Number.isNaN(byteOffset) ? 0 : Math.trunc(byteOffset);

        if (!Number.isSafeInteger(byteIndex) || byteIndex < 0) {
            throw new RangeError("Offset is outside the bounds of the DataView");
        }

        const uint8Value = value & 0xff;

        if (byteIndex >= this.#bytes.length) {
            throw new RangeError("Offset is outside the bounds of the DataView");
        }

        this.#bytes[byteIndex] = uint8Value;
    }

    pushUint8(value: number): void {
        this.#bytes.push(value & 0xff);
    }

    pushUint8s(value: Iterable<number>): void {
        for (const byte of value) this.pushUint8(byte);
    }

    getBigUint64(byteOffset: number, littleEndian?: boolean): bigint {
        const byteIndex = Number.isNaN(byteOffset) ? 0 : Math.trunc(byteOffset);

        if (
            !Number.isSafeInteger(byteIndex) ||
            byteIndex < 0 ||
            byteIndex + 8 > this.#bytes.length
        ) {
            throw new RangeError("Offset is outside the bounds of the DataView");
        }

        let value = 0n;
        for (let i = 0; i < 8; i++) {
            const nextByteIndex = byteIndex + (littleEndian ? 7 - i : i);
            value = (value << 8n) | BigInt(this.#bytes[nextByteIndex]!);
        }
        return value;
    }

    setBigUint64(byteOffset: number, value: bigint, littleEndian?: boolean): void {
        const byteIndex = Number.isNaN(byteOffset) ? 0 : Math.trunc(byteOffset);

        if (!Number.isSafeInteger(byteIndex) || byteIndex < 0) {
            throw new RangeError("Offset is outside the bounds of the DataView");
        }

        const bigUint64Value = BigInt.asUintN(64, value);

        if (byteIndex + 8 > this.#bytes.length) {
            throw new RangeError("Offset is outside the bounds of the DataView");
        }

        for (let i = 0; i < 8; i++) {
            const nextByteIndex = byteIndex + (littleEndian ? i : 7 - i);
            this.#bytes[nextByteIndex] = Number((bigUint64Value >> BigInt(i * 8)) & 0xffn);
        }
    }

    pushBigUint64(value: bigint, littleEndian?: boolean): void {
        const bigUint64Value = BigInt.asUintN(64, value);

        for (let i = 0; i < 8; i++) {
            const byteShift = BigInt((littleEndian ? i : 7 - i) * 8);
            this.#bytes.push(Number((bigUint64Value >> byteShift) & 0xffn));
        }
    }
}
