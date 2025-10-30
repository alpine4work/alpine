import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {
    JsonStringifiableUint8Array,
    Schema,
    SchemaDeserializationError,
} from "~/shared/schema/schema.js";

/**
 * Preview content for a code file. To preview a code file we take the first
 * couple lines of the file, syntax highlight them, and display the syntax
 * highlighted text. By syntax highlighting on the server, the client doesn't
 * need to have loaded the language's syntax highlighter.
 *
 * Code previews can get a little large. The maximum size of a code preview is
 * ~9kb. However, that assumes every Unicode code point is 4 bytes long, the
 * preview is completely filled with code points, and each code point is
 * highlighted. In practice code previews should be an order of magnitude
 * smaller.
 *
 * Since we always send the code preview down when a code file is visible we
 * encode the code preview in binary to make sure it's the absolute smallest
 * possible size.
 *
 * ## Format
 *
 * Specification for the file code preview content binary format in [BNF][1].
 *
 * The atoms in our syntax are bytes in binary notation (e.g. "00000010" is 2
 * in decimal notation). If a letter is used that represents arbitrary bits
 * (e.g. "aaa" could be "000", "001", "010", "011", etc.). The number of bits
 * is intentional. In "0aaaaaaa" there are 7 "a"s. This plus 0 makes a full
 * byte (which is 8 bits long).
 *
 * ```
 * <content> ::= ""
 *             | <content> <content-item>
 *
 * <content-item> ::= <newline>
 *                  | <string>
 *
 * <newline> ::= "00000001"
 *
 * <string> ::= <highlight> <string-utf8> "00000000"
 *
 * <highlight> ::= "00000000"
 *               | "0aaaaaaa"
 *               | "1bbbbbbb" "0bbbbbbb"
 *           where "aaaaaaa" != "0000001"
 *
 * <string-utf8> ::= ""
 *                 | <string> "cccccccc"
 *             where "cccccccc" != "00000000"
 * ```
 *
 * In `<highlight>`, "aaaaaaa" and "bbbbbbb" represent `index + 2` where
 * `index` is in index in `lezerClassHighlighterClasses`. It's necessary to add
 * 2 so there's no ambiguity with an empty `<highlight>` (which is 0) or with
 * `<newline>` (which is 1).
 *
 * `<string-utf8>` is in UTF-8 encoding. It may not contain null bytes since we
 * use a null byte to terminate the string.
 *
 * [1]: https://en.wikipedia.org/wiki/Backus%E2%80%93Naur_form
 */
export type FileCodePreviewContent = InstanceType<typeof FileCodePreviewContent>;

/**
 * The maximum number of lines we'll show in the preview of a code file.
 */
export const maxFileCodePreviewLineCount = 16;

/**
 * The maximum number of code points we show for each line in a code file.
 *
 * Our preview aims to show almost exactly 80 characters. We include 5 more
 * characters to make sure we can fully fill the preview.
 */
export const maxFileCodePreviewLineCodePointCount = 85;

/**
 * The maximum number of highlight classes we may use on each substring in some
 * code preview. By setting a limit we add an upper bound on how large code
 * previews can be.
 */
const maxFileCodePreviewHighlightClassCount = 2;

/**
 * The max byte length of some `FileCodePreviewContent`. It ends up being ~9kb.
 * We rarely approach this size since most code files are sparse, don't
 * highlight every character, and use predominantly ASCII characters.
 */
const maxFileCodePreviewByteLength =
    // Maximum number of Unicode code points in a code preview.
    maxFileCodePreviewLineCount *
        maxFileCodePreviewLineCodePointCount *
        // Maximum number of bytes to encode each code point.
        //
        // - 2: Each character might be highlighted and we have a max of 2 highlight
        //   classes per highlight.
        // - 4: A Unicode code point is encoded as 1-4 bytes in UTF-8. So at max we'll
        //   encode 4 bytes.
        // - 1: If each character is highlighted then we need a null byte after each
        //   character.
        (maxFileCodePreviewHighlightClassCount + 4 + 1) +
    // One byte for every line.
    maxFileCodePreviewLineCount;

/**
 * How many times does 2 factor into `maxFileCodePreviewByteLength`? We use this
 * to determine our initial `FileCodePreviewContent` buffer size. It means we
 * can double the buffer's size with `resize()` this many times.
 */
const maxFileCodePreviewByteLength2FactorCount = 4;

export type LezerClassHighlighterClass = (typeof lezerClassHighlighterClasses)[number];

/**
 * All the Lezer highlight classes we use.
 *
 * This lives in `shared/files` to prevent cyclic import errors with
 * `shared/content/code`.
 *
 * IMPORTANT: Do not change the order of items in this array!
 * `FileCodePreviewContent`'s binary format depends on the index of each class
 * staying the same. If you need to add a new class then add it to the end.
 */
const lezerClassHighlighterClasses = [
    "tok-atom",
    "tok-bool",
    "tok-className",
    "tok-comment",
    "tok-controlKeyword",
    "tok-definition",
    "tok-deleted",
    "tok-emphasis",
    "tok-heading",
    "tok-inserted",
    "tok-invalid",
    "tok-keyword",
    "tok-labelName",
    "tok-link",
    "tok-literal",
    "tok-local",
    "tok-macroName",
    "tok-meta",
    "tok-moduleKeyword",
    "tok-namespace",
    "tok-number",
    "tok-operator",
    "tok-propertyName",
    "tok-punctuation",
    "tok-punctuation2",
    "tok-string",
    "tok-string2",
    "tok-strong",
    "tok-typeName",
    "tok-url",
    "tok-variableName",
    "tok-variableName2",
    "tok-monospace",
] as const;

let lezerClassHighlighterByteByClass: Map<string, number> | null = null;

/**
 * Get a map of Lezer highlight classes to the byte which represents the class
 * in our binary encoding of `FileCodePreviewContent`. The byte is +2 the
 * class's index in `lezerClassHighlighterClasses`.
 */
function getLezerClassHighlighterByteByClass() {
    if (lezerClassHighlighterByteByClass === null) {
        lezerClassHighlighterByteByClass = new Map();

        for (let i = 0; i < lezerClassHighlighterClasses.length; i++) {
            const class_ = lezerClassHighlighterClasses[i]!;
            const byte = i + 2;

            assert(!lezerClassHighlighterByteByClass.has(class_));
            assert(byte <= 2 ** 8 - 1);
            assert((byte & 0b10000000) === 0);

            lezerClassHighlighterByteByClass.set(class_, byte);
        }
    }

    return lezerClassHighlighterByteByClass;
}

export const FileCodePreviewContent = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyArray<
        | {readonly type: "Newline"}
        | {readonly type: "String"; readonly classes: string; readonly string: string}
    >
>(Schema.bytes, {
    serialize: items => {
        const initialByteLength =
            maxFileCodePreviewByteLength / 2 ** maxFileCodePreviewByteLength2FactorCount;
        assert(Number.isInteger(initialByteLength));

        const buffer = new ArrayBuffer(initialByteLength, {
            maxByteLength: maxFileCodePreviewByteLength,
        });
        let byteOffset = 0;
        let lineCount = 0;
        let lineCodePointCount = 0;
        const view = new DataView(buffer);
        const encoder = new TextEncoder();

        for (const item of items) {
            switch (item.type) {
                case "Newline": {
                    lineCount += 1;
                    lineCodePointCount = 0;
                    assert(lineCount <= maxFileCodePreviewLineCount);

                    view.setUint8(byteOffset, 1);
                    byteOffset += 1;
                    break;
                }
                case "String": {
                    const stringCodePoints = Array.from(item.string);

                    lineCodePointCount += stringCodePoints.length;
                    assert(lineCodePointCount <= maxFileCodePreviewLineCodePointCount);

                    const classBytes = filterMapArray(
                        item.classes.split(" ").slice(0, maxFileCodePreviewHighlightClassCount),
                        class_ => getLezerClassHighlighterByteByClass().get(class_),
                    );

                    // If we don't have enough space to write this code, double our buffer's size.
                    // We multiply `substringCodePoints.length` by 4 to be conservative. At most
                    // each Unicode code point will be encoded as 4 bytes in UTF-8.
                    while (
                        byteOffset +
                            Math.max(1, classBytes.length) +
                            stringCodePoints.length * 4 +
                            1 >
                        buffer.byteLength
                    ) {
                        buffer.resize(buffer.byteLength * 2);
                    }

                    if (classBytes.length === 0) {
                        view.setUint8(byteOffset, 0);
                        byteOffset += 1;
                    } else {
                        for (let i = 0; i < classBytes.length; i++) {
                            const classByte = classBytes[i]!;

                            if (i === classBytes.length - 1) {
                                view.setUint8(byteOffset, classByte);
                                byteOffset += 1;
                            } else {
                                view.setUint8(byteOffset, classByte | 0b10000000);
                                byteOffset += 1;
                            }
                        }
                    }

                    for (let codePoint of stringCodePoints) {
                        // Replace the null Unicode code point with the [Unicode replacement
                        // character][1]. We use null terminated strings to signal when a highlight
                        // is done.
                        //
                        // [1]: https://graphemica.com/FFFD
                        if (codePoint === "\u0000") {
                            codePoint = "\uFFFD";
                        }

                        const result = encoder.encodeInto(
                            codePoint,
                            new Uint8Array(buffer, byteOffset),
                        );
                        byteOffset += result.written ?? 0;
                    }

                    view.setUint8(byteOffset, 0);
                    byteOffset += 1;
                    break;
                }
                default:
                    throw exhaustive(item);
            }
        }

        buffer.resize(byteOffset);

        return new JsonStringifiableUint8Array(buffer);
    },
    deserialize: data => {
        let byteOffset = 0;
        const decoder = new TextDecoder();

        const items: Array<
            | {readonly type: "Newline"}
            | {readonly type: "String"; readonly classes: string; readonly string: string}
        > = [];

        while (byteOffset < data.length) {
            const byte = data[byteOffset]!;

            if (byte === 1) {
                byteOffset += 1;
                items.push({type: "Newline"});
                continue;
            }

            let classes: string;

            if (byte === 0) {
                byteOffset += 1;
                classes = "";
            } else if (byte & 0b10000000) {
                if (byteOffset + 1 >= data.length) {
                    throw new SchemaDeserializationError("Expected another byte");
                }

                const byte2 = data[byteOffset + 1]!;

                const class1 = lezerClassHighlighterClasses[(byte & 0b01111111) - 2];
                const class2 = lezerClassHighlighterClasses[byte2 - 2];

                if (class1 === undefined || class2 === undefined) {
                    throw new SchemaDeserializationError(
                        "Expected byte to correspond with highlight class",
                    );
                }

                byteOffset += 1;
                byteOffset += 1;
                classes = `${class1} ${class2}`;
            } else {
                const class_ = lezerClassHighlighterClasses[(byte & 0b01111111) - 2];

                if (class_ === undefined) {
                    throw new SchemaDeserializationError(
                        "Expected byte to correspond with highlight class",
                    );
                }

                byteOffset += 1;
                classes = class_;
            }

            const stringEndIndex = data.indexOf(0, byteOffset);
            if (stringEndIndex === -1) {
                throw new SchemaDeserializationError("Expected null terminator byte");
            }
            const stringLength = stringEndIndex - byteOffset;

            const string = decoder.decode(
                new Uint8Array(data.buffer, data.byteOffset + byteOffset, stringLength),
            );

            byteOffset += stringLength;
            byteOffset += 1;
            items.push({type: "String", classes, string});
        }

        return items;
    },
});
