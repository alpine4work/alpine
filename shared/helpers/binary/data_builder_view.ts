import {assert} from "~/shared/helpers/control/assert.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

/**
 * Shared interface between `DataView` and `DataBuilderView`.
 */
export interface DataViewInterface {
    readonly byteOffset: number;
    readonly byteLength: number;

    getUint8(byteOffset: number): number;
    setUint8(byteOffset: number, value: number): void;
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
    readonly #bytes: Array<number> = [];

    build(): Uint8Array {
        return new Uint8Array(this.#bytes);
    }

    get byteOffset(): number {
        return 0;
    }

    get byteLength(): number {
        return this.#bytes.length;
    }

    getUint8(byteOffset: number): number {
        assert(Number.isSafeInteger(byteOffset));
        assert(byteOffset >= 0);
        assert(byteOffset < this.#bytes.length);

        return this.#bytes[byteOffset]!;
    }

    setUint8(byteOffset: number, value: number): void {
        assert(Number.isSafeInteger(byteOffset));
        assert(byteOffset >= 0);
        assert(byteOffset < this.#bytes.length);

        // NOCOMMIT: What behavior does `DataView` have for incorrect `value`s?
        assert(Number.isSafeInteger(value));
        assert(value >= 0);
        assert(value <= 2 ** 8 - 1);

        this.#bytes[byteOffset] = value;
    }

    pushUint8(value: number): void {
        assert(Number.isSafeInteger(value));
        assert(value >= 0);
        assert(value <= 2 ** 8 - 1);

        this.#bytes.push(value);
    }
}
