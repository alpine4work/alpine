/**
 * Check if two byte arrays are equal to each other.
 */
// Adapted from: https://stackoverflow.com/a/52181275/1568890
export function areUint8ArraysEqual(array1: Uint8Array, array2: Uint8Array): boolean {
    if (array1 === array2) return true;
    if (array1.byteLength != array2.byteLength) return false;

    let a: Uint8Array | Uint16Array | Uint32Array = array1;
    let b: Uint8Array | Uint16Array | Uint32Array = array2;

    if (aligned32(a) && aligned32(b)) {
        a = new Uint32Array(a.buffer, a.byteOffset, a.byteLength / 4);
        b = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    } else if (aligned16(a) && aligned16(b)) {
        a = new Uint16Array(a.buffer, a.byteOffset, a.byteLength / 2);
        b = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
    }

    // Iterate back to front so we start with the most significant bits.
    for (let i = a.length; -1 < i; i -= 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

function aligned16(array: {byteOffset: number; byteLength: number}) {
    return array.byteOffset % 2 === 0 && array.byteLength % 2 === 0;
}

function aligned32(array: {byteOffset: number; byteLength: number}) {
    return array.byteOffset % 4 === 0 && array.byteLength % 4 === 0;
}
