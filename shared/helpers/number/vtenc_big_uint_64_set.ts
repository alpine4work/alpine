/**
 * NOTE(calebmer, 2023-07-26): This is a TypeScript port of the [VTEnc compression
 * C library][1].
 *
 * The C library is written with a lot of function inlining and templates. These
 * language constructs produce new code statically. JavaScript does not have
 * similar constructs so I've manually inlined many functions which might be
 * marginally better for performance than if they were separate functions like in
 * the source library.
 *
 * [1]: https://github.com/vteromero/VTEnc
 *
 * MIT License
 *
 * Copyright (c) 2019 Vicente Romero Calero
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * A sorted, unique, set of unsigned 64-bit integers encoded using the [VTEnc
 * compression algorithm][1]. This algorithm has great compression ratios and
 * performance for sorted integer lists.
 *
 * [1]: https://vteromero.github.io/2019/07/28/vtenc.html
 */
export type VtencBigUint64Set = Uint8Array & {readonly _VtencBigUint64Set: never};

// Our implementation is for 64-bit unsigned integers.
const bitWidth = 64;

// Constant from:
// https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/internals.h#L21
const bitStreamMaxWrite = 56n;
const bitStreamMaxRead = bitStreamMaxWrite;

// Default set by `vtenc_init()`. Increasing should improve encoding speed.
// https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/common.c#L20
const minClusterLength = 1;

// prettier-ignore
const bitsPosMask64 = [
                   0x1n,                0x2n,                0x4n,                0x8n,
                  0x10n,               0x20n,               0x40n,               0x80n,
                 0x100n,              0x200n,              0x400n,              0x800n,
                0x1000n,             0x2000n,             0x4000n,             0x8000n,
               0x10000n,            0x20000n,            0x40000n,            0x80000n,
              0x100000n,           0x200000n,           0x400000n,           0x800000n,
             0x1000000n,          0x2000000n,          0x4000000n,          0x8000000n,
            0x10000000n,         0x20000000n,         0x40000000n,         0x80000000n,
           0x100000000n,        0x200000000n,        0x400000000n,        0x800000000n,
          0x1000000000n,       0x2000000000n,       0x4000000000n,       0x8000000000n,
         0x10000000000n,      0x20000000000n,      0x40000000000n,      0x80000000000n,
        0x100000000000n,     0x200000000000n,     0x400000000000n,     0x800000000000n,
       0x1000000000000n,    0x2000000000000n,    0x4000000000000n,    0x8000000000000n,
      0x10000000000000n,   0x20000000000000n,   0x40000000000000n,   0x80000000000000n,
     0x100000000000000n,  0x200000000000000n,  0x400000000000000n,  0x800000000000000n,
    0x1000000000000000n, 0x2000000000000000n, 0x4000000000000000n, 0x8000000000000000n,
];

// prettier-ignore
const bitsSizeMask = [
                   0x0n,
                   0x1n,                0x3n,                0x7n,                0xfn,
                  0x1fn,               0x3fn,               0x7fn,               0xffn,
                 0x1ffn,              0x3ffn,              0x7ffn,              0xfffn,
                0x1fffn,             0x3fffn,             0x7fffn,             0xffffn,
               0x1ffffn,            0x3ffffn,            0x7ffffn,            0xfffffn,
              0x1fffffn,           0x3fffffn,           0x7fffffn,           0xffffffn,
             0x1ffffffn,          0x3ffffffn,          0x7ffffffn,          0xfffffffn,
            0x1fffffffn,         0x3fffffffn,         0x7fffffffn,         0xffffffffn,
           0x1ffffffffn,        0x3ffffffffn,        0x7ffffffffn,        0xfffffffffn,
          0x1fffffffffn,       0x3fffffffffn,       0x7fffffffffn,       0xffffffffffn,
         0x1ffffffffffn,      0x3ffffffffffn,      0x7ffffffffffn,      0xfffffffffffn,
        0x1fffffffffffn,     0x3fffffffffffn,     0x7fffffffffffn,     0xffffffffffffn,
       0x1ffffffffffffn,    0x3ffffffffffffn,    0x7ffffffffffffn,    0xfffffffffffffn,
      0x1fffffffffffffn,   0x3fffffffffffffn,   0x7fffffffffffffn,   0xffffffffffffffn,
     0x1ffffffffffffffn,  0x3ffffffffffffffn,  0x7ffffffffffffffn,  0xfffffffffffffffn,
    0x1fffffffffffffffn, 0x3fffffffffffffffn, 0x7fffffffffffffffn, 0xffffffffffffffffn,
];

/**
 * Encodes a sorted, unique, set of unsigned 64-bit integers using the [VTEnc
 * compression algorithm][1]. This algorithm has great compression ratios and
 * performance for sorted integer lists. We use the `bigint` type to properly
 * support 64-bit integers in JavaScript.
 *
 * It's safe to pass in an unsorted list with repeat values to this function. We
 * will make sure values are sorted and unique.
 *
 * [1]: https://vteromero.github.io/2019/07/28/vtenc.html
 */
export function encodeVtencBigUint64Set(values: Iterable<bigint>): VtencBigUint64Set {
    return encodeVtencBigUint64SetAssumingSortedAndUnique(
        Array.from(new Set(values), value => {
            assert(
                0 <= value && value <= 2n ** 64n - 1n,
                "Values must be unsigned 64-bit integers",
            );
            return value;
        }).sort((a, b) => Number(a - b)),
    );
}

type EncodeBitCluster = {
    from: number;
    length: number;
    bitPos: number;
};

/**
 * Encodes a sorted, unique, set of unsigned 64-bit integers using the [VTEnc
 * compression algorithm][1]. This algorithm has great compression ratios and
 * performance for sorted integer lists. We use the `bigint` type to properly
 * support 64-bit integers in JavaScript.
 *
 * You must pass in a sorted and unique list of integers to this function!
 * Otherwise you'll get undefined behavior. You may use `encodeVtencBigInt64Set()`
 * which makes sure your list of integers is sorted and unique before calling this
 * function.
 *
 * [1]: https://vteromero.github.io/2019/07/28/vtenc.html
 */
// This function is derived from `encode_bit_cluster_tree`:
// https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encode_generic.h#L93-L124
export function encodeVtencBigUint64SetAssumingSortedAndUnique(
    values: ReadonlyArray<bigint>,
): VtencBigUint64Set {
    // NOTE(calebmer, 2023-07-26): Ideally we'd use a resizable `ArrayBuffer` but it
    // isn't implemented in Firefox.
    const maxEncodedSize = 4 + (bitWidth / 8) * (values.length + 1) + 8;
    const buffer = new ArrayBuffer(maxEncodedSize);

    const writer = new DataView(buffer);
    let writerByteOffset = 0;
    let writerBitContainer = 0n;
    let writerBitPos = 0n;

    // Derived from `bswriter_write`:
    // https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/bitstream.h#L82-L99
    const write = (value: bigint, nBits: bigint) => {
        const totalBits = writerBitPos + nBits;
        const nBytes = totalBits >> 3n;

        assert(nBits <= bitStreamMaxWrite);
        assert(nBits + writerBitPos < 64n);

        writerBitContainer |= value << writerBitPos;

        writer.setBigUint64(writerByteOffset, writerBitContainer, true);

        writerByteOffset += Number(nBytes);
        writerBitPos = totalBits & 7n;
        writerBitContainer >>= nBytes << 3n;
    };

    // Derived from `bswriter_append`:
    // https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/bitstream.h#L46-L54
    const append = (value: bigint, nBits: bigint) => {
        assert(nBits <= bitStreamMaxWrite);
        assert(nBits + writerBitPos < 64n);

        writerBitContainer |= (value & bitsSizeMask[Number(nBits)]!) << writerBitPos;
        writerBitPos += nBits;
    };

    // Derived from `bswriter_flush`:
    // https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/bitstream.h#L70-L80
    const flush = () => {
        const nBytes = writerBitPos >> 3n;

        writer.setBigUint64(writerByteOffset, writerBitContainer, true);

        writerByteOffset += Number(nBytes);
        writerBitPos &= 7n;
        writerBitContainer >>= nBytes << 3n;
    };

    writer.setUint32(writerByteOffset, values.length, true);
    writerByteOffset += 4;

    const stack: Array<EncodeBitCluster> = [];

    if (values.length > 0) {
        stack.push({
            from: 0,
            length: values.length,
            bitPos: bitWidth,
        });
    }

    while (stack.length > 0) {
        const {from: clusterFrom, length: clusterLength, bitPos: clusterBitPos} = stack.pop()!;
        const currentBitPos = clusterBitPos - 1;

        // Is this a full subtree? If so we can skip full subtrees. There is an option to
        // toggle this off in VTEnc. It's simple to implement and sometimes improves the
        // compression ratio so why not.
        //
        // Inlined `is_full_subtree` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encode_generic.h#L104-L105
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/common.h#L14-L17
        if (BigInt(clusterLength) === bitsPosMask64[clusterBitPos]) {
            continue;
        }

        // Inlined `encode_lower_bits` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encode_generic.h#L108
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encodebits.inc.h#L136-L148
        if (clusterLength <= minClusterLength) {
            const batchSize = Math.min(4, Math.floor(Number(bitStreamMaxWrite) / clusterBitPos));
            const nBits = BigInt(clusterBitPos);

            let from = clusterFrom;
            let length = clusterLength;

            if (batchSize > 1) {
                while (length >= batchSize) {
                    for (let i = 0; i < batchSize; i++) {
                        append(values[from + i]!, nBits);
                    }
                    flush();

                    from += batchSize;
                    length -= batchSize;
                }
            }

            for (let i = 0; i < length; i++) {
                const value = values[from + i]!;

                if (nBits <= bitStreamMaxWrite) {
                    append(value, nBits);
                    flush();
                } else {
                    append(value, bitStreamMaxWrite);
                    flush();
                    append(value >> bitStreamMaxWrite, nBits - bitStreamMaxWrite);
                    flush();
                }
            }
            continue;
        }

        // Inlined `count_zeros_at_bit_pos` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encode_generic.h#L112
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/countbits.h#L11-L24
        let nZeros: number;
        if (clusterLength === 0) {
            nZeros = 0;
        } else {
            const mask = bitsPosMask64[currentBitPos]!;
            let base = clusterFrom;
            let length = clusterLength;

            while (length > 1) {
                const half = length >> 1;
                base = (values[base + half]! & mask) === 0n ? base + half : base;
                length -= half;
            }

            nZeros = ((values[base]! & mask) === 0n ? 1 : 0) + base - clusterFrom;
        }

        // Inlined `bits_len_u64` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encode_generic.h#L113
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/bits.h#L173-L199
        const encodeLength = clusterLength === 0 ? 1 : 32 - Math.clz32(clusterLength);

        write(BigInt(nZeros), BigInt(encodeLength));

        const zerosCluster: EncodeBitCluster = {
            from: clusterFrom,
            length: nZeros,
            bitPos: currentBitPos,
        };

        const onesCluster: EncodeBitCluster = {
            from: clusterFrom + nZeros,
            length: clusterLength - nZeros,
            bitPos: currentBitPos,
        };

        if (onesCluster.bitPos !== 0 && onesCluster.length !== 0) {
            stack.push(onesCluster);
        }

        if (zerosCluster.bitPos !== 0 && zerosCluster.length !== 0) {
            stack.push(zerosCluster);
        }
    }

    return new Uint8Array(
        buffer.slice(0, writerByteOffset + (writerBitPos > 0n ? 1 : 0)),
    ) as VtencBigUint64Set;
}

type DecodeBitCluster = {
    from: number;
    length: number;
    bitPos: number;
    higherBits: bigint;
};

/**
 * Decodes a sorted, unique, set of unsigned 64-bit integers from the [VTEnc
 * compression algorithm][1]. This algorithm has great compression ratios and
 * performance for sorted integer lists. We use the `bigint` type to properly
 * support 64-bit integers in JavaScript.
 *
 * [1]: https://vteromero.github.io/2019/07/28/vtenc.html
 */
// This function is derived from `decode_bit_cluster_tree`:
// https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/decode_generic.h#L118-L161
export function decodeVtencBigUint64List(set: VtencBigUint64Set): Array<bigint> {
    const reader = new DataView(set.buffer);
    let readerByteOffset = 0;
    let readerBitContainer = 0n;
    let readerBitPos = 0n;

    const read = (nBits: bigint): bigint => {
        const nBytes = reader.byteLength - readerByteOffset;

        if (nBytes >= 8) {
            readerBitContainer = reader.getBigUint64(readerByteOffset, true);
        } else {
            readerBitContainer = 0n;

            for (let i = 0; i < nBytes; i++) {
                readerBitContainer <<= 8n;
                readerBitContainer |= BigInt(reader.getUint8(readerByteOffset + (nBytes - 1 - i)));
            }
        }

        assert(nBits <= bitStreamMaxRead);
        assert(nBits + readerBitPos < 64n);

        const value = (readerBitContainer >> readerBitPos) & ((1n << nBits) - 1n);

        readerByteOffset += Number((readerBitPos + nBits) >> 3n);
        readerBitPos = (readerBitPos + nBits) & 7n;

        return value;
    };

    const valuesLength = reader.getUint32(readerByteOffset, true);
    readerByteOffset += 4;

    const values: Array<bigint> = Array(valuesLength);

    const stack: Array<DecodeBitCluster> = [];

    if (valuesLength > 0) {
        stack.push({
            from: 0,
            length: valuesLength,
            bitPos: bitWidth,
            higherBits: 0n,
        });
    }

    while (stack.length > 0) {
        const {
            from: clusterFrom,
            length: clusterLength,
            bitPos: clusterBitPos,
            higherBits: clusterHigherBits,
        } = stack.pop()!;

        if (clusterBitPos === 0) {
            for (let i = 0; i < clusterLength; i++) {
                values[clusterFrom + i] = clusterHigherBits;
            }
            continue;
        }

        // Is this a full subtree? If so it's omitted and we need to reconstruct it. There
        // is an option to toggle this off in VTEnc. It's simple to implement and sometimes
        // improves the compression ratio so why not.
        //
        // Inlined `is_full_subtree` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/decode_generic.h#L137
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/common.h#L14-L17
        //
        // Also inlines `decode_full_subtree` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/decode_generic.h#L138
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/decode_generic.h#L92-L97
        if (BigInt(clusterLength) === bitsPosMask64[clusterBitPos]) {
            for (let i = 0; i < clusterLength; i++) {
                values[clusterFrom + i] = clusterHigherBits | BigInt(i);
            }
            continue;
        }

        // Inlined `decode_lower_bits` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/decode_generic.h#L143
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/decode_generic.h#L84-L90
        if (clusterLength <= minClusterLength) {
            const nBits = BigInt(clusterBitPos);

            for (let i = 0; i < clusterLength; i++) {
                if (nBits <= bitStreamMaxRead) {
                    values[clusterFrom + i] = clusterHigherBits | read(nBits);
                } else {
                    values[clusterFrom + i] =
                        clusterHigherBits |
                        (read(bitStreamMaxRead) |
                            (read(nBits - bitStreamMaxRead) << bitStreamMaxRead));
                }
            }
            continue;
        }

        // Inlined `bits_len_u64` function:
        //
        // - Call:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/encode_generic.h#L113
        // - Definition:
        //   https://github.com/vteromero/VTEnc/blob/5a21e63a035dbbb98555b52661777991beb093c0/bits.h#L173-L199
        const encodeLength = clusterLength === 0 ? 1 : 32 - Math.clz32(clusterLength);

        const nZeros = Number(read(BigInt(encodeLength)));
        if (nZeros > clusterLength) throw new InvalidArgumentError("Invalid VTEnc encoding");

        const nextBitPos = clusterBitPos - 1;

        const zerosCluster: DecodeBitCluster = {
            from: clusterFrom,
            length: nZeros,
            bitPos: nextBitPos,
            higherBits: clusterHigherBits,
        };

        const onesCluster: DecodeBitCluster = {
            from: clusterFrom + nZeros,
            length: clusterLength - nZeros,
            bitPos: nextBitPos,
            higherBits: clusterHigherBits | (1n << BigInt(nextBitPos)),
        };

        if (onesCluster.length !== 0) {
            stack.push(onesCluster);
        }

        if (zerosCluster.length !== 0) {
            stack.push(zerosCluster);
        }
    }

    return values;
}

/**
 * Is the provided compressed integer set empty?
 */
export function isVtencBigInt64SetEmpty(set: VtencBigUint64Set): boolean {
    if (set.byteLength !== 4) return false;

    const reader = new DataView(set.buffer);
    const valuesLength = reader.getUint32(0, true);

    return valuesLength === 0;
}
