import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {OrderKey, isOrderKey, orderKeyDigits} from "~/shared/helpers/sort/order_key.open_source.js";

const orderKeyDigitIndexByChar = new Map<string, number>(
    orderKeyDigits.split("").map((char, index) => [char, index]),
);

/**
 * Get the number of bytes our `OrderKey` is encoded into by `encodeOrderKey()`.
 */
export function getOrderKeyByteCount(orderKey: OrderKey): number {
    return Math.ceil((orderKey.length * 6) / 8);
}

/**
 * Encodes an `OrderKey` to binary. Each `OrderKey` digit is encoded as 6 bits.
 */
export function encodeOrderKey(orderKey: OrderKey): Uint8Array {
    const bytes = new Uint8Array(getOrderKeyByteCount(orderKey));
    encodeOrderKeyInto(orderKey, bytes, 0);
    return bytes;
}

export function encodeOrderKeyInto(
    orderKey: OrderKey,
    bytes: Uint8Array,
    byteOffset: number,
): void {
    const byteCount = getOrderKeyByteCount(orderKey);
    bytes.fill(0, byteOffset, byteOffset + byteCount);

    for (let i = 0; i < orderKey.length; i++) {
        const digit = orderKeyDigitIndexByChar.get(orderKey[i]!)! + 1;
        assert(1 <= digit && digit <= 63);

        const bitOffset = i * 6;
        const byteIndex = byteOffset + Math.floor(bitOffset / 8);
        const bitOffsetInByte = bitOffset % 8;
        const firstByteBitCount = Math.min(6, 8 - bitOffsetInByte);
        const secondByteBitCount = 6 - firstByteBitCount;
        const firstByteShift = 8 - bitOffsetInByte - firstByteBitCount;

        bytes[byteIndex] = bytes[byteIndex]! | ((digit >> secondByteBitCount) << firstByteShift);

        if (secondByteBitCount > 0) {
            const secondByteMask = (1 << secondByteBitCount) - 1;
            bytes[byteIndex + 1] =
                bytes[byteIndex + 1]! | ((digit & secondByteMask) << (8 - secondByteBitCount));
        }
    }
}

/**
 * Decodes an `OrderKey` from binary.
 */
export function decodeOrderKey(bytes: Uint8Array): OrderKey {
    let orderKey = "";
    const digitCount = Math.floor((bytes.length * 8) / 6);

    for (let digitIndex = 0; digitIndex < digitCount; digitIndex++) {
        const bitOffset = digitIndex * 6;
        const byteIndex = Math.floor(bitOffset / 8);
        const bitOffsetInByte = bitOffset % 8;
        const firstByteBitCount = Math.min(6, 8 - bitOffsetInByte);
        const secondByteBitCount = 6 - firstByteBitCount;
        const firstByteShift = 8 - bitOffsetInByte - firstByteBitCount;
        const firstByteMask = (1 << firstByteBitCount) - 1;

        let digit = (bytes[byteIndex]! >> firstByteShift) & firstByteMask;

        if (secondByteBitCount > 0) {
            digit =
                (digit << secondByteBitCount) | (bytes[byteIndex + 1]! >> (8 - secondByteBitCount));
        }

        if (digit === 0) break;
        assert(1 <= digit && digit <= 63);
        orderKey += orderKeyDigits[digit - 1]!;
    }

    assert(isOrderKey(orderKey), "Invalid order key");
    return orderKey;
}
