import {InvalidArgumentError} from "~/shared/error/error.js";
import {
    DataBuilderView,
    type DataViewInterface,
} from "~/shared/helpers/binary/data_builder_view.js";

export type VarIntResult = {
    readonly value: number;
    readonly byteOffset: number;
};

/**
 * Pushes a non-negative integer with variable length encoding to
 * `DataBuilderView`. Uses the same variable length encoding as protocol buffers.
 */
export function pushVarInt(view: DataBuilderView, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new InvalidArgumentError("Varint value must be a non-negative safe integer");
    }

    let n = value;
    while (n >= 0x80) {
        view.pushUint8((n % 0x80) | 0x80);
        n = Math.floor(n / 0x80);
    }

    view.pushUint8(n);
}

/**
 * Reads a non-negative variable length integer from a view. Reads the same
 * variable length encoding as protocol buffers and returns the offset after the
 * integer.
 */
export function getVarInt(view: DataViewInterface, byteOffset: number): VarIntResult {
    byteOffset = Math.trunc(byteOffset);

    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
        throw new RangeError("Offset is outside the bounds of the DataView");
    }

    let value = 0;
    let multiplier = 1;

    while (byteOffset < view.byteLength) {
        const byte = view.getUint8(byteOffset);
        byteOffset += 1;

        const digit = byte & 0x7f;
        if (digit > (Number.MAX_SAFE_INTEGER - value) / multiplier) {
            throw new InvalidArgumentError("Invalid varint encoding");
        }

        value += digit * multiplier;

        if ((byte & 0x80) === 0) {
            return {value, byteOffset};
        }

        if (multiplier > Number.MAX_SAFE_INTEGER / 0x80) {
            throw new InvalidArgumentError("Invalid varint encoding");
        }

        multiplier *= 0x80;
    }

    throw new InvalidArgumentError("Invalid varint encoding");
}
