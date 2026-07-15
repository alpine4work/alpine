import {TypedFastBitSet} from "typedfastbitset";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

const bytesPerWord = 4;

/**
 * A compact wire representation of a {@link TypedFastBitSet}.
 *
 * Words are encoded as unsigned 32-bit little-endian integers. Trailing zero words
 * are omitted, so the empty bitset serializes to an empty byte array.
 */
export const BitsetSchema = Schema.bytes.transform<TypedFastBitSet>({
    serialize: bitset => {
        let wordCount = bitset.words.length;
        while (wordCount > 0 && bitset.words[wordCount - 1] === 0) {
            wordCount--;
        }

        const bytes = new Uint8Array(wordCount * bytesPerWord);
        for (let wordIndex = 0; wordIndex < wordCount; wordIndex++) {
            const word = bitset.words[wordIndex]!;
            const byteOffset = wordIndex * bytesPerWord;
            bytes[byteOffset] = word;
            bytes[byteOffset + 1] = word >>> 8;
            bytes[byteOffset + 2] = word >>> 16;
            bytes[byteOffset + 3] = word >>> 24;
        }
        return bytes;
    },
    deserialize: bytes => {
        if (bytes.byteLength % bytesPerWord !== 0) {
            throw new SchemaDeserializationError(
                "Expected bitset bytes to contain complete 32-bit words",
            );
        }

        const words = new Uint32Array(bytes.byteLength / bytesPerWord);
        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
            const byteOffset = wordIndex * bytesPerWord;
            words[wordIndex] =
                (bytes[byteOffset]! |
                    (bytes[byteOffset + 1]! << 8) |
                    (bytes[byteOffset + 2]! << 16) |
                    (bytes[byteOffset + 3]! << 24)) >>>
                0;
        }
        return TypedFastBitSet.fromWords(words);
    },
});
