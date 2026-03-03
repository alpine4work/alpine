import {Fragment, Node, Slice} from "prosemirror-model";
import {ContentMarkTypeName} from "~/shared/content/content_node_type_name.js";
import {MessageContentSchema} from "~/shared/content/message_content_schema.js";
import {SimpleContentProsemirrorSchema} from "~/shared/content/simple_content_schema.js";
import {trimContent} from "~/shared/content/trim_content.js";
import {HighlightColor} from "~/shared/design/core/highlight_color.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Plain data representation for marks used in duplication. This doesn't depend on
 * ProseMirror types, making it usable across different content schemas (documents,
 * task notes, messages).
 */
export type ContentDuplicationMark =
    | {readonly type: "italic"}
    | {readonly type: "bold"}
    | {readonly type: "code"}
    | {readonly type: "strike"}
    | {readonly type: "highlight"; readonly color: HighlightColor};

/**
 * Schema for marks used in duplication.
 */
export const ContentDuplicationMarkSchema: Schema<ContentDuplicationMark> = Schema.union({
    italic: Schema.object({type: Schema.value("italic")}),
    bold: Schema.object({type: Schema.value("bold")}),
    code: Schema.object({type: Schema.value("code")}),
    strike: Schema.object({type: Schema.value("strike")}),
    highlight: Schema.object({
        type: Schema.value("highlight"),
        color: Schema.enum(HighlightColor),
    }),
});

export type ContentDuplicationVariableSchema = SchemaType<
    typeof ContentDuplicationVariableSchemaSchema
>;

export type ContentDuplicationVariableSchemaProperty = SchemaType<
    typeof ContentDuplicationVariableSchemaPropertySchema
>;

export type ContentDuplicationVariableSchemaTextProperty = SchemaType<
    typeof ContentDuplicationVariableSchemaTextPropertySchema
>;

export type ContentDuplicationVariableSchemaContentProperty = SchemaType<
    typeof ContentDuplicationVariableSchemaContentPropertySchema
>;

export const ContentDuplicationVariableSchemaTextPropertySchema = Schema.object({
    type: Schema.value("Text"),
    marks: Schema.array(ContentDuplicationMarkSchema),
});

export const ContentDuplicationVariableSchemaContentPropertySchema = Schema.object({
    type: Schema.value("Content"),
});

export const ContentDuplicationVariableSchemaPropertySchema = Schema.union({
    Text: ContentDuplicationVariableSchemaTextPropertySchema,
    Content: ContentDuplicationVariableSchemaContentPropertySchema,
});

export const ContentDuplicationVariableSchemaSchema = Schema.map(
    Schema.string,
    ContentDuplicationVariableSchemaPropertySchema,
);

export type ContentDuplicationVariableValues = SchemaType<
    typeof ContentDuplicationVariableValuesSchema
>;

export type ContentDuplicationVariableValuesProperty = SchemaType<
    typeof ContentDuplicationVariableValuesPropertySchema
>;

export const ContentDuplicationVariableValuesPropertySchema = Schema.union({
    Text: Schema.object({
        type: Schema.value("Text"),
        text: Schema.string,
        marks: Schema.array(ContentDuplicationMarkSchema),
    }),
    Content: Schema.object({
        type: Schema.value("Content"),
        content: MessageContentSchema,
    }),
});

export const ContentDuplicationVariableValuesSchema = Schema.map(
    Schema.string,
    ContentDuplicationVariableValuesPropertySchema,
);

/**
 * Convert a ProseMirror mark to our plain data representation.
 */
function intoContentDuplicationMark(mark: {
    type: {name: string};
    attrs?: {color?: HighlightColor};
}): ContentDuplicationMark | undefined {
    const typeName = mark.type.name as ContentMarkTypeName;

    switch (typeName) {
        case "italic":
            return {type: "italic"};
        case "bold":
            return {type: "bold"};
        case "code":
            return {type: "code"};
        case "strike":
            return {type: "strike"};
        case "highlight":
            return {type: "highlight", color: mark.attrs?.color ?? HighlightColor.Red};
        default:
            return undefined;
    }
}

/**
 * Check if two marks are equal.
 */
function areContentDuplicationMarksEqual(
    a: ContentDuplicationMark,
    b: ContentDuplicationMark,
): boolean {
    if (a.type !== b.type) return false;
    if (a.type === "highlight" && b.type === "highlight") {
        return a.color === b.color;
    }
    return true;
}

/**
 * Check if a mark exists in a list of marks.
 */
function isContentDuplicationMarkInSet(
    mark: ContentDuplicationMark,
    marks: ReadonlyArray<ContentDuplicationMark>,
): boolean {
    return marks.some(m => areContentDuplicationMarksEqual(mark, m));
}

/**
 * Extract duplication variables from content. Used by the client to determine if
 * we should show the variable input form and to encode variables in the URL.
 *
 * @param doc - The ProseMirror document to extract variables from. @param
 * options.additionalText - Additional plain text strings to scan for variables
 * (e.g. task title). Variables found here are merged with content variables. If a
 * variable appears only in additionalText, it's always Text type. If a variable
 * appears in both, Content type is demoted to Text.
 */
export function extractContentDuplicationVariableSchema(
    doc: Node,
    options?: {
        additionalText?: ReadonlyArray<string>;
    },
): ContentDuplicationVariableSchema {
    const {schema} = doc.type;

    const variableByName = new Map<
        string,
        {
            isContent: boolean;
            marks: ReadonlyArray<ContentDuplicationMark>;
        }
    >();

    // First, extract variables from additional text strings
    if (options?.additionalText) {
        for (const text of options.additionalText) {
            if (text.length === 0) continue;
            parseTextblock(null, schema.node("paragraph", {}, [schema.text(text)]));
        }
    }

    // Then extract variables from the document content
    doc.descendants((node, nodePos) => {
        if (!node.isTextblock) return true;
        parseTextblock(nodePos, node);
        return true;
    });

    return new Map<string, ContentDuplicationVariableSchemaProperty>(
        mapIterable(variableByName.entries(), ([name, {isContent, marks}]) => {
            if (isContent) {
                return [name, {type: "Content"}];
            } else {
                return [name, {type: "Text", marks: [...marks]}];
            }
        }),
    );

    function parseTextblock(nodePos: number | null, node: Node) {
        let state: {
            phase: "{" | "{{" | "{{}";
            startTextIndex: number;
            name: string;
            marks: ReadonlyArray<ContentDuplicationMark> | null;
        } | null = null;

        for (
            let childNodeIndex = 0;
            childNodeIndex < node.content.content.length;
            childNodeIndex++
        ) {
            const childNode = node.content.content[childNodeIndex]!;

            // Variables in a code block get the code mark.
            const childNodeMarks: ReadonlyArray<ContentDuplicationMark> =
                node.type.name === "codeBlockLine"
                    ? [
                          {type: "code"},
                          ...filterMapIterable(childNode.marks, intoContentDuplicationMark),
                      ]
                    : filterMapArray(childNode.marks, intoContentDuplicationMark);

            // Reset parsing if we run into a non-text node (e.g. a mention).
            if (!childNode.isText) {
                state = null;
                continue;
            }

            let text = childNode.text!;

            // Trim the text. We allow variables with trailing whitespace to be considered rich
            // text content.
            if (childNodeIndex === 0) text = text.trimStart();
            if (childNodeIndex === node.content.content.length - 1) text = text.trimEnd();

            for (let textIndex = 0; textIndex < text.length; textIndex++) {
                const character = text[textIndex]!;

                if (state === null) {
                    if (character === "{" && (textIndex === 0 || text[textIndex - 1] !== "{")) {
                        state = {
                            phase: "{",
                            startTextIndex: textIndex,
                            name: "",
                            marks: null,
                        };
                    }
                    continue;
                }

                switch (state.phase) {
                    case "{": {
                        if (character === "{") {
                            state.phase = "{{";
                        } else {
                            state = null;
                        }
                        break;
                    }
                    case "{{": {
                        if (character === "}") {
                            state.phase = "{{}";
                        } else if (character === "{") {
                            state = null;
                        } else {
                            state.name += character;
                            state.marks ??= childNodeMarks;

                            // We only use marks that are applied to every character in the variable's name.
                            if (childNodeMarks !== state.marks) {
                                state.marks = state.marks.filter(mark =>
                                    isContentDuplicationMarkInSet(mark, childNodeMarks),
                                );
                            }
                        }
                        break;
                    }
                    case "{{}": {
                        if (character !== "}") {
                            state = null;
                            break;
                        }

                        const {startTextIndex} = state;
                        const name = state.name.trim();
                        const marks = state.marks ?? emptyArray;
                        state = null;

                        // Don't allow names that are empty after trimming.
                        if (name.length === 0) break;

                        const existingVariable = variableByName.get(name);

                        // This is rich text content if all variables with this name are in their own empty
                        // root-level paragraph AND the variable wasn't found in additionalText (which
                        // means it needs to work in plain text).
                        const isContentInThisOccurrence =
                            nodePos !== null &&
                            node.type.name === "paragraph" &&
                            node.childCount === 1 &&
                            doc.resolve(nodePos).depth === 0 &&
                            startTextIndex === 0 &&
                            textIndex === text.length - 1;

                        variableByName.set(name, {
                            // Only Content if this occurrence is content AND all previous occurrences were
                            // also content. If a variable appeared in additionalText,
                            // existingVariable.isContent will be false.
                            isContent:
                                (existingVariable?.isContent ?? true) && isContentInThisOccurrence,

                            // We only use marks that are applied to every variable name wherever it appears in
                            // the document.
                            marks:
                                existingVariable === undefined
                                    ? marks
                                    : existingVariable.marks.filter(mark =>
                                          isContentDuplicationMarkInSet(mark, marks),
                                      ),
                        });
                        break;
                    }
                    default:
                        throw exhaustive(state.phase);
                }
            }
        }
    }
}

/**
 * Mark type to bit position mapping for binary encoding. We use bits 0-3 to encode
 * which simple marks (non-highlight) are present on a Text variable. Highlight is
 * handled separately since it has a color attribute.
 */
const bitPositionByContentDuplicationMarkType: Readonly<
    Record<Exclude<ContentDuplicationMark["type"], "highlight">, number>
> = {
    italic: 0,
    bold: 1,
    code: 2,
    strike: 3,
};

/**
 * Highlight color to byte value mapping for binary encoding. We use bits 4-7 of
 * the marks byte to encode the highlight color (0 = no highlight).
 */
const byteValueByHighlightColor: Readonly<Record<HighlightColor, number>> = {
    [HighlightColor.Red]: 1,
    [HighlightColor.Orange]: 2,
    [HighlightColor.Green]: 3,
    [HighlightColor.Blue]: 4,
    [HighlightColor.Purple]: 5,
};

const highlightColorByByteValue: ReadonlyMap<number, HighlightColor> = new Map(
    getObjectEntriesWithKeyofType(byteValueByHighlightColor).map(([color, byteValue]) => [
        byteValue,
        color,
    ]),
);

/**
 * Encode the duplication schema for URL search params using a compact binary
 * format with base64 encoding.
 *
 * Binary format:
 *
 * - Byte 0: Version marker (high bit = 1) + entry count (7 bits)
 * - For each entry:
 *     - Byte: Type (1 = Text, 2 = Content)
 *     - For Text: Byte with marks bitset
 *     - Byte: Name length (UTF-8 byte length)
 *     - Bytes: Name (UTF-8 encoded)
 */
export function encodeContentDuplicationVariableSchemaForUrl(
    schema: ContentDuplicationVariableSchema,
): string | null {
    if (schema.size === 0) return null;
    if (schema.size > 127) throw new InvalidArgumentError("Too many schema entries");

    // Pre-compute the buffer size
    const encoder = new TextEncoder();
    const nameBytes: Array<Uint8Array> = [];
    let totalByteCount = 1; // Version + count byte

    for (const [name, propertySchema] of schema) {
        const nameEncoded = encoder.encode(name);
        if (nameEncoded.length > 255) throw new InvalidArgumentError("Property name too long");
        nameBytes.push(nameEncoded);
        totalByteCount += 1; // Type byte
        if (propertySchema.type === "Text") totalByteCount += 1; // Marks bitset
        totalByteCount += 1; // Name length byte
        totalByteCount += nameEncoded.length; // Name bytes
    }

    const buffer = new ArrayBuffer(totalByteCount);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Version marker (high bit = 1) + entry count
    view.setUint8(0, 0b10000000 | schema.size);

    let byteOffset = 1;
    let nameIndex = 0;

    for (const [, propertySchema] of schema) {
        const nameEncoded = nameBytes[nameIndex++]!;

        if (propertySchema.type === "Text") {
            view.setUint8(byteOffset++, 1); // Type = Text

            // Encode marks as bitset (bits 0-3) and highlight color (bits 4-7)
            let marksByte = 0;
            for (const mark of propertySchema.marks) {
                if (mark.type === "highlight") {
                    // Encode highlight color in bits 4-7
                    const colorValue = byteValueByHighlightColor[mark.color] ?? 0;
                    marksByte |= colorValue << 4;
                } else {
                    // Encode simple marks in bits 0-3
                    const bitPosition = assertExists(
                        bitPositionByContentDuplicationMarkType[mark.type],
                    );
                    marksByte |= 1 << bitPosition;
                }
            }
            view.setUint8(byteOffset++, marksByte);
        } else {
            view.setUint8(byteOffset++, 2); // Type = Content
        }

        view.setUint8(byteOffset++, nameEncoded.length);
        bytes.set(nameEncoded, byteOffset);
        byteOffset += nameEncoded.length;
    }

    return encodeBase64(bytes, "Rfc4648Url");
}

/**
 * Decode the duplication params from URL search params.
 */
export function decodeContentDuplicationVariableSchemaFromUrl(
    schemaString: string | null | undefined,
): ContentDuplicationVariableSchema {
    if (schemaString === null || schemaString === undefined) return emptyMap;

    const bytes = decodeBase64(schemaString, "Rfc4648Url");
    const view = new DataView(bytes.buffer);
    const decoder = new TextDecoder();

    const versionAndCount = view.getUint8(0);
    if (!(versionAndCount & 0b10000000)) {
        throw new InvalidArgumentError("Unrecognized schema binary encoding");
    }

    const entryCount = versionAndCount & 0b01111111;
    const schema = new Map<string, ContentDuplicationVariableSchemaProperty>();

    let byteOffset = 1;

    for (let i = 0; i < entryCount; i++) {
        const typeByte = view.getUint8(byteOffset++);

        let propertySchema: ContentDuplicationVariableSchemaProperty;

        if (typeByte === 1) {
            // Text type
            const marksByte = view.getUint8(byteOffset++);
            const marks: Array<ContentDuplicationMark> = [];

            // Decode simple marks from bits 0-3
            for (const [markTypeName, bitPosition] of getObjectEntriesWithKeyofType(
                bitPositionByContentDuplicationMarkType,
            )) {
                if (marksByte & (1 << bitPosition)) {
                    marks.push({type: markTypeName});
                }
            }

            // Decode highlight color from bits 4-7
            const highlightColorValue = marksByte >> 4;
            if (highlightColorValue !== 0) {
                const highlightColor = highlightColorByByteValue.get(highlightColorValue);
                if (highlightColor !== undefined) {
                    marks.push({type: "highlight", color: highlightColor});
                }
            }

            propertySchema = {type: "Text", marks};
        } else if (typeByte === 2) {
            // Content type
            propertySchema = {type: "Content"};
        } else {
            throw new InvalidArgumentError(`Unrecognized property type ${typeByte}`);
        }

        const nameLength = view.getUint8(byteOffset++);
        const name = decoder.decode(bytes.subarray(byteOffset, byteOffset + nameLength));
        byteOffset += nameLength;

        schema.set(name, propertySchema);
    }

    return schema;
}

/**
 * Replace duplication variables in document content with actual values. Works with
 * any ProseMirror Node type (DocumentContent, TaskNotesContent, etc.).
 */
export function applyContentDuplicationVariableValues(
    doc: Node,
    values: ContentDuplicationVariableValues,
): Node {
    const {schema} = doc.type;

    const replaces: Array<{from: number; to: number; slice: Slice}> = [];

    doc.descendants((node, nodePos) => {
        if (!node.isTextblock) return true;

        let state: {
            phase: "{" | "{{" | "{{}";
            startPos: number;
            name: string;
        } | null = null;

        let workingChildNodePos = nodePos + 1;

        outer: for (const childNode of node.content.content) {
            const childNodePos = workingChildNodePos;
            workingChildNodePos += childNode.nodeSize;

            // Reset parsing if we run into a non-text node (e.g. a mention).
            if (!childNode.isText) {
                state = null;
                continue;
            }

            // Don't trim here! (Unlike `extractContentDuplicationVariableSchema()`.) Since we
            // need accurate node positions to perform the replace.
            const text = childNode.text!;

            for (let textIndex = 0; textIndex < text.length; textIndex++) {
                const character = text[textIndex]!;

                if (state === null) {
                    if (character === "{" && (textIndex === 0 || text[textIndex - 1] !== "{")) {
                        state = {
                            phase: "{",
                            startPos: childNodePos + textIndex,
                            name: "",
                        };
                    }
                    continue;
                }

                switch (state.phase) {
                    case "{": {
                        if (character === "{") {
                            state.phase = "{{";
                        } else {
                            state = null;
                        }
                        break;
                    }
                    case "{{": {
                        if (character === "}") {
                            state.phase = "{{}";
                        } else {
                            state.name += character;
                        }
                        break;
                    }
                    case "{{}": {
                        if (character !== "}") {
                            state = null;
                            break;
                        }

                        const {startPos} = state;
                        const name = state.name.trim();
                        state = null;

                        // Don't allow names that are empty after trimming.
                        if (name.length === 0) break;

                        const value = values.get(name);
                        if (value === undefined) break;

                        switch (value.type) {
                            case "Text": {
                                const trimmedValueText = value.text.trim();

                                // Don't replace an empty text value. Not setting values is the same as a noop.
                                if (trimmedValueText.length === 0) break;

                                // Convert our plain mark representation to ProseMirror marks
                                const marks = value.marks.map(mark => {
                                    const markType = assertExists(schema.marks[mark.type]);
                                    if (mark.type === "highlight") {
                                        return markType.create({color: mark.color});
                                    }
                                    return markType.create();
                                });

                                replaces.push({
                                    from: startPos,
                                    to: childNodePos + textIndex + 1,
                                    slice: new Slice(
                                        Fragment.from(schema.text(trimmedValueText, marks)),
                                        0,
                                        0,
                                    ),
                                });
                                break;
                            }
                            case "Content": {
                                // Parse the content JSON using the document's schema
                                const contentNode = schema.nodeFromJSON(value.content.toJSON());
                                const trimmedValueContent = trimContent(contentNode);

                                const isEmpty = (node: Node) => {
                                    if (node.isText) return node.text!.trim().length === 0;
                                    if (node.isInline) return false;
                                    return node.content.content.every(isEmpty);
                                };

                                // Don't replace if the content is empty
                                if (isEmpty(trimmedValueContent)) {
                                    break;
                                }

                                replaces.push({
                                    from: nodePos,
                                    to: nodePos + node.nodeSize,
                                    slice: new Slice(trimmedValueContent.content, 0, 0),
                                });

                                // Break to outer loop to defend against case where there are now two variables in
                                // this block. To have a content value we must have had content schema. To have a
                                // content schema the value was the only one on its block.
                                break outer;
                            }
                            default:
                                throw exhaustive(value);
                        }
                        break;
                    }
                    default:
                        throw exhaustive(state.phase);
                }
            }
        }

        return true;
    });

    // Replace in reverse order to avoid invalidating positions.
    replaces.reverse();

    for (const replace of replaces) {
        doc = doc.replace(replace.from, replace.to, replace.slice);
    }

    return doc;
}

/**
 * Apply duplication values to plain text (e.g. task titles). Only Text values are
 * used; Content values are kept as-is.
 */
export function applyContentDuplicationVariableValuesToText(
    text: string,
    values: ContentDuplicationVariableValues,
): string {
    if (text.length === 0) return text;

    const schema = SimpleContentProsemirrorSchema;

    const node = applyContentDuplicationVariableValues(
        schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text(text)])]),
        values,
    );

    return node.textContent;
}
