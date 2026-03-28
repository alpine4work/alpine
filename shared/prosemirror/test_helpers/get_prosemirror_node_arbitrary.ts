import fc, {Arbitrary} from "fast-check";
import {ContentMatch, Mark, MarkType, Node, NodeType} from "prosemirror-model";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {maxContentListItemIndentation} from "~/shared/content/content_schema.js";
import {highlightColors} from "~/shared/design/core/highlight_color.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {LinkedList, fromLinkedList} from "~/shared/helpers/immutable/linked_list.js";
import {averageIterable} from "~/shared/helpers/iterable/average_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {intersectSets} from "~/shared/helpers/set/intersect_sets.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {ChronologicalId, generateChronologicalId} from "~/shared/id/chronological_id.js";
import {RandomId, generateId} from "~/shared/id/id.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
} from "~/shared/id/types/id_types.js";

const prosemirrorNodeArbitraryByParentMarkSetByType = new Map<
    NodeType,
    Map<string, fc.Arbitrary<Node> | "Creating">
>();

const prosemirrorMarkArbitraryByType = new Map<MarkType, fc.Arbitrary<Mark>>();

export function getProsemirrorNodeArbitrary(
    nodeType: NodeType,
    parentMarkSet: ReadonlySet<MarkType>,
) {
    const parentMarkSetString = [...parentMarkSet]
        .map(mark => mark.name)
        .sort(defaultCompareStrings)
        .join(", ");

    const nodeArbitraryByParentMarkSet = getOrSetDefaultMapValue(
        prosemirrorNodeArbitraryByParentMarkSetByType,
        nodeType,
        () => new Map(),
    );

    const existingNodeArbitrary = nodeArbitraryByParentMarkSet.get(parentMarkSetString);

    if (existingNodeArbitrary !== undefined) {
        if (existingNodeArbitrary === "Creating") {
            throw new UnimplementedError(
                "Circular dependency detected, ProseMirror node `fast-check` arbitrary recursion hasn\u2019t been implemented yet",
            );
        }
        return existingNodeArbitrary;
    }

    nodeArbitraryByParentMarkSet.set(parentMarkSetString, "Creating");
    const nodeArbitrary = actuallyCreateProsemirrorNodeArbitrary(nodeType, parentMarkSet);
    nodeArbitraryByParentMarkSet.set(parentMarkSetString, nodeArbitrary);
    return nodeArbitrary;
}

function actuallyCreateProsemirrorNodeArbitrary(
    nodeType: NodeType,
    parentMarkSet: ReadonlySet<MarkType>,
): fc.Arbitrary<Node> {
    const nodeMarkSet = new Set(nodeType.markSet ?? Object.values(nodeType.schema.marks));
    const markSet = intersectSets(parentMarkSet, nodeMarkSet);

    let marksArbitrary: Arbitrary<ReadonlyArray<Mark> | undefined>;
    if (markSet.size === 0 || (!nodeType.isText && !nodeType.isLeaf)) {
        marksArbitrary = fc.constant(undefined);
    } else {
        const markArbitrary = fc.oneof(
            ...Array.from(markSet, markType => ({
                weight: getProsemirrorMarkTypeWeight(markType),
                arbitrary: getProsemirrorMarkArbitrary(markType),
            })),
        );

        marksArbitrary = fc.oneof(
            {weight: 100, arbitrary: fc.constant(undefined)},
            {weight: 10, arbitrary: markArbitrary.map(mark => [mark])},
            {
                weight: 1,
                arbitrary: fc.array(markArbitrary, {minLength: 2, maxLength: 3}).map(marks => {
                    let dedupedMarks: ReadonlyArray<Mark> = [];

                    for (const mark of marks) {
                        dedupedMarks = mark.addToSet(dedupedMarks);
                    }

                    return dedupedMarks;
                }),
            },
        );
    }

    if (nodeType.isText) {
        const textArbitrary = fc.array(
            // Small set of tokens to increase the liklihood we generate content with some
            // equal tokens.
            fc.oneof(
                fc.constant("a"),
                fc.constant("b"),
                fc.constant("c"),
                fc.constant("d"),
                fc.constant("e"),
                fc.constant("f"),
                fc.constant("g"),
                fc.constant("h"),
                fc.constant("i"),
                fc.constant("j"),
                fc.constant("k"),
                fc.constant("l"),
                fc.constant("m"),
                fc.constant("n"),
                fc.constant("o"),
                fc.constant("p"),
                fc.constant("q"),
                fc.constant("r"),
                fc.constant("s"),
                fc.constant("t"),
                fc.constant("u"),
                fc.constant("v"),
                fc.constant("w"),
                fc.constant("x"),
                fc.constant("y"),
                fc.constant("z"),
                fc.constant("0"),
                fc.constant("1"),
                fc.constant("2"),
                fc.constant("3"),
                fc.constant("4"),
                fc.constant("5"),
                fc.constant("6"),
                fc.constant("7"),
                fc.constant("8"),
                fc.constant("9"),
            ),
            // Small since textblock nodes like `paragraph()` generate 1-5 text children that
            // get concatenated.
            {minLength: 1, maxLength: 3},
        );

        return fc
            .record({text: textArbitrary, marks: marksArbitrary})
            .map(({text, marks}) => nodeType.schema.text(text.join(" "), marks));
    }

    const contentMatchArbitrary = createProsemirrorContentMatchArbitrary(
        nodeType.contentMatch,
        parentMarkSet,
    );

    const arbitraryByAttr = new Map<string, Arbitrary<unknown>>();

    for (const [attr, attrSpec] of Object.entries(nodeType.spec.attrs ?? {})) {
        const arbitraryAttr = createProsemirrorAttrArbitrary(attr).map(value => {
            // Make sure the generated value matches our schema.
            const serilaizedValue = attrSpec.schema.serialize(value);
            const deserializedValue = attrSpec.schema.deserialize(serilaizedValue);
            return deserializedValue;
        });

        arbitraryByAttr.set(attr, arbitraryAttr);
    }

    return fc
        .record({
            attrs: fc.record(Object.fromEntries(arbitraryByAttr)),
            content: contentMatchArbitrary,
            marks: marksArbitrary,
        })
        .map(({attrs, content, marks}) => {
            return nodeType.createChecked(
                attrs,
                fromLinkedList(content)
                    .flat()
                    .map((childNode, index, childNodes) => {
                        // If we have two adjacent text nodes then add a space between them so we don't
                        // create a new token with the last letter of the previous text + the first letter
                        // of the next text.
                        if (childNode.isText && childNodes[index + 1]?.isText) {
                            return nodeType.schema.text(childNode.text + " ");
                        }

                        return childNode;
                    }),
                marks,
            );
        });
}

function createProsemirrorContentMatchArbitrary(
    contentMatch: ContentMatch,
    parentMarkSet: ReadonlySet<MarkType>,
): fc.Arbitrary<LinkedList<Node | Array<Node>>> {
    const edges = createArrayWithLength(contentMatch.edgeCount, n => contentMatch.edge(n));

    const weightedArbitraries: Array<fc.WeightedArbitrary<LinkedList<Node | Array<Node>>>> = [];

    if (contentMatch.validEnd) {
        weightedArbitraries.push({
            weight: getProsemirrorNodeTypeWeight(null),
            arbitrary: fc.constant(null),
        });
    }

    const recursiveEdges: Array<{type: NodeType; next: ContentMatch}> = [];

    for (const edge of edges) {
        if (edge.next === contentMatch) {
            recursiveEdges.push(edge);
            continue;
        }

        const nodeArbitrary = getProsemirrorNodeArbitrary(edge.type, parentMarkSet);
        const nextContentMatchArbitrary = createProsemirrorContentMatchArbitrary(
            edge.next,
            parentMarkSet,
        );

        weightedArbitraries.push({
            weight: getProsemirrorNodeTypeWeight(edge.type),
            arbitrary: fc.record({
                value: nodeArbitrary,
                next: nextContentMatchArbitrary,
            }),
        });
    }

    if (recursiveEdges.length > 0) {
        const weightedArbitrariesWithoutRecursiveEdge = [...weightedArbitraries];

        const nodeWeightedArbitraries = recursiveEdges.map(edge => ({
            weight: getProsemirrorNodeTypeWeight(edge.type),
            arbitrary: getProsemirrorNodeArbitrary(edge.type, parentMarkSet),
        }));

        weightedArbitraries.push({
            weight: Math.round(
                averageIterable(mapIterable(nodeWeightedArbitraries, ({weight}) => weight)),
            ),
            arbitrary: fc.record({
                value: fc.array(fc.oneof(...nodeWeightedArbitraries), {
                    minLength: 1,
                    maxLength: 5,
                }),
                next: fc.oneof(...weightedArbitrariesWithoutRecursiveEdge),
            }),
        });
    }

    return fc.oneof(...weightedArbitraries);
}

function getProsemirrorNodeTypeWeight(nodeType: NodeType | null): number {
    if (nodeType === null) {
        return 1;
    }

    if (nodeType.isText) {
        return 20;
    }

    if (nodeType.name === "paragraph") {
        return 20;
    }

    if (nodeType.groups.includes("listItem")) {
        return 5;
    }

    if (nodeType.name === "quoteBlock") {
        return 2;
    }

    return 1;
}

function getProsemirrorMarkArbitrary(markType: MarkType) {
    return getOrSetDefaultMapValue(
        prosemirrorMarkArbitraryByType,
        markType,
        actuallyCreateProsemirrorMarkArbitrary,
    );
}

function actuallyCreateProsemirrorMarkArbitrary(markType: MarkType): fc.Arbitrary<Mark> {
    const arbitraryByAttr = new Map<string, Arbitrary<unknown>>();

    for (const [attr, attrSpec] of Object.entries(markType.spec.attrs ?? {})) {
        const arbitraryAttr = createProsemirrorAttrArbitrary(attr).map(value => {
            // Make sure the generated value matches our schema.
            const serilaizedValue = attrSpec.schema.serialize(value);
            const deserializedValue = attrSpec.schema.deserialize(serilaizedValue);
            return deserializedValue;
        });

        arbitraryByAttr.set(attr, arbitraryAttr);
    }

    return fc.record(Object.fromEntries(arbitraryByAttr)).map(attrs => markType.create(attrs));
}

function getProsemirrorMarkTypeWeight(markType: MarkType): number {
    if (markType.name === "bold" || markType.name === "italic") {
        return 200;
    }

    if (markType.name === "comment") {
        return 1;
    }

    return 10;
}

// Use TypeScript `Record` so we get a type error when a type is added to the
// union, reminding us that we need to add another entry.
function createUnionArbitrary<Union extends {readonly type: string}>(
    object: Record<Union["type"], fc.MaybeWeightedArbitrary<Union>>,
): fc.Arbitrary<Union> {
    const arbitraries: Array<fc.MaybeWeightedArbitrary<Union>> = Object.values(object);
    return fc.oneof(...arbitraries);
}

function createIdArbitrary<Value extends RandomId>(): fc.Arbitrary<Value> {
    // Only allow selection from 5 IDs to improve our odds of generating a match.
    return fc.oneof(...createArrayWithLength(5, () => fc.constant(generateId<Value>())));
}

function createChronologicalIdArbitrary<Value extends ChronologicalId>(): fc.Arbitrary<Value> {
    // Only allow selection from 5 IDs to improve our odds of generating a match.
    return fc.oneof(
        ...createArrayWithLength(5, () => fc.constant(generateChronologicalId<Value>())),
    );
}

function createProsemirrorAttrArbitrary(attr: string): fc.Arbitrary<unknown> {
    switch (attr) {
        case "mention": {
            return createUnionArbitrary<ContentMention>({
                Account: fc.record({
                    type: fc.constant("Account"),
                    accountId: createIdArbitrary<AccountId>(),
                    isShort: fc.boolean(),
                }),
                SearchEntity: fc.record({
                    type: fc.constant("SearchEntity"),
                    entityId: createIdArbitrary<DocumentId>().map(id => `Document:${id}` as const),
                }),
            });
        }
        case "indent": {
            return fc.oneof(
                {weight: 100, arbitrary: fc.constant(1)},
                {weight: 1, arbitrary: fc.integer({min: 2, max: maxContentListItemIndentation})},
            );
        }
        case "orderStart": {
            return fc.oneof(
                {weight: 1000, arbitrary: fc.constant(null)},
                {weight: 1, arbitrary: fc.integer({min: 1, max: 5})},
            );
        }
        case "checked": {
            return fc.boolean();
        }
        // We don't vary code block attributes much we want as many tests as possible to
        // try and make changes within a code block.
        case "language": {
            return cast<Arbitrary<ContentCodeBlockLanguageId>>(
                fc.oneof(fc.constant("text"), fc.constant("javascript")),
            );
        }
        case "level": {
            return fc.integer({min: 1, max: 3});
        }
        case "fileId": {
            return createChronologicalIdArbitrary<FileId>();
        }
        case "columnWidths": {
            return fc.constant([]);
        }
        case "tableWidth": {
            return fc.constant(1);
        }
        // We don't vary table attributes since we want as many tests as possible to try
        // and make changes within a table. 1/100 times we'll vary the table `hasHeaderRow`
        // attribute so we still exercise table attribute changes.
        case "hasHeaderRow": {
            return fc.oneof(
                {weight: 100, arbitrary: fc.constant(false)},
                {weight: 1, arbitrary: fc.constant(true)},
            );
        }
        case "hasHeaderColumn": {
            return fc.constant(false);
        }
        case "direction": {
            return fc.oneof(fc.constant("left"), fc.constant("right"));
        }
        case "commentThreadId": {
            return createIdArbitrary<DocumentCommentThreadId>();
        }
        case "url": {
            return fc.oneof(
                fc.constant("https://example.com"),
                fc.constant("https://alpine.inc"),
                fc.constant("https://cyberworlds.dev"),
            );
        }
        case "color": {
            return fc.oneof(...Array.from(highlightColors, color => fc.constant(color)));
        }
        default:
            throw new UnimplementedError(quote`Unimplemented arbitrary for attr ${attr}`);
    }
}
