import {ChangeSet} from "prosemirror-changeset";
import {Node} from "prosemirror-model";
import {
    AddMarkStep,
    AddNodeMarkStep,
    DocAttrStep,
    Mapping,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceStep,
    Step,
    StepMap,
} from "prosemirror-transform";
import {contentStyles} from "~/client/web/styles/styles.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {diff} from "~/shared/helpers/diff/diff.js";
import {ProsemirrorHtmlSerializationDecoration} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";

/**
 * A changed range in the start document (`A`) and end document (`B`) coordinate
 * spaces.
 */
type ContentChangesetRange = {
    readonly fromA: number;
    readonly toA: number;
    readonly fromB: number;
    readonly toB: number;
};

type ContentChangesetNodeDecoration = Extract<
    ProsemirrorHtmlSerializationDecoration,
    {readonly type: "Node"}
>;

/**
 * Builds a renderable document-history diff from ProseMirror steps.
 *
 * `endDoc` contains the result of applying the steps. `renderedDoc` also inserts
 * deleted content so the serialized decorations can show deletions alongside
 * insertions.
 */
export function createContentChangesetDecorations({
    startDoc,
    steps,
}: {
    startDoc: Node;
    steps: ReadonlyArray<Step>;
}): {
    endDoc: Node;
    renderedDoc: Node;
    decorations: ReadonlyArray<ProsemirrorHtmlSerializationDecoration>;
    hasOnlyCoverChanges: boolean;
} {
    let endDoc = startDoc;
    const stepMaps: Array<StepMap> = [];
    const formattingRanges: Array<{from: number; to: number; stepMapIndex: number}> = [];

    for (const step of steps) {
        const result = step.apply(endDoc);
        assert(result.doc, result.failed ?? "Couldn\u2019t apply document history step");
        endDoc = result.doc;
        if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
            // `ChangeSet` excludes mark-only steps, so render them as replacements.
            formattingRanges.push({from: step.from, to: step.to, stepMapIndex: stepMaps.length});
        }
        if (step instanceof AddNodeMarkStep || step instanceof RemoveNodeMarkStep) {
            const node = assertExists(endDoc.nodeAt(step.pos));
            formattingRanges.push({
                from: step.pos,
                to: step.pos + node.nodeSize,
                stepMapIndex: stepMaps.length,
            });
        }
        stepMaps.push(step.getMap());
    }

    const changeSet = ChangeSet.create<null>(startDoc).addSteps(endDoc, stepMaps, null);
    const semanticTopLevelInsertionRanges = getSemanticTopLevelInsertionRanges({
        startDoc,
        endDoc,
        steps,
    });

    const decorations: Array<ProsemirrorHtmlSerializationDecoration> = [];
    const unexpandedChangeRanges =
        semanticTopLevelInsertionRanges ??
        mergeContentChangesetRanges([
            ...changeSet.changes.map(
                (change): ContentChangesetRange => ({
                    fromA: change.fromA,
                    toA: change.toA,
                    fromB: change.fromB,
                    toB: change.toB,
                }),
            ),
            // A formatting step uses the coordinate space immediately before it. Map that
            // range back to the start document and forward to the end document.
            ...formattingRanges.map(
                (formattingRange): ContentChangesetRange => ({
                    fromA: new Mapping(stepMaps.slice(0, formattingRange.stepMapIndex))
                        .invert()
                        .map(formattingRange.from, 1),
                    toA: new Mapping(stepMaps.slice(0, formattingRange.stepMapIndex))
                        .invert()
                        .map(formattingRange.to, -1),
                    fromB: new Mapping(stepMaps.slice(formattingRange.stepMapIndex + 1)).map(
                        formattingRange.from,
                        1,
                    ),
                    toB: new Mapping(stepMaps.slice(formattingRange.stepMapIndex + 1)).map(
                        formattingRange.to,
                        -1,
                    ),
                }),
            ),
        ]);
    // Render a complete text block replacement as separate old and new blocks.
    const changeRanges = unexpandedChangeRanges.map(range =>
        expandContentChangesetRangeToWholeTextBlocks({range, startDoc, endDoc}),
    );

    let renderedDoc = endDoc;
    // Each reinserted deletion moves later decorations in the rendered document.
    const endDocToRenderedDocMapping = new Mapping();
    const renderedChangeRanges: Array<ContentChangesetRange> = [];

    for (const [index, expandedChangeRange] of changeRanges.entries()) {
        const unexpandedChangeRange = assertExists(unexpandedChangeRanges[index]);
        let renderedChangeRange = unexpandedChangeRange;

        for (const changeRange of [expandedChangeRange, unexpandedChangeRange]) {
            if (changeRange.fromA >= changeRange.toA) {
                renderedChangeRange = changeRange;
                break;
            }

            const deletedSlice = startDoc.slice(changeRange.fromA, changeRange.toA);
            const from = endDocToRenderedDocMapping.map(changeRange.fromB, 1);
            const to = from + deletedSlice.size;
            const $from = renderedDoc.resolve(from);
            // A deleted slice must fit at this position without violating the document schema.
            // Fall back to the smaller change range if it does not.
            if (
                deletedSlice.openStart !== 0 ||
                deletedSlice.openEnd !== 0 ||
                !$from.parent.canReplace($from.index(), $from.index(), deletedSlice.content)
            ) {
                continue;
            }

            renderedDoc = renderedDoc.replace(from, from, deletedSlice);
            endDocToRenderedDocMapping.appendMap(new StepMap([from, 0, deletedSlice.size]));

            const tableCellDecorations = getContentChangesetNodeDecorations({
                doc: renderedDoc,
                from,
                to,
                className: contentStyles.contentChangesetDeletedTableCellClassName,
                nodeTypeName: "tableCell",
            });

            decorations.push(...tableCellDecorations);

            if (renderedDoc.textBetween(from, to, "") !== "") {
                decorations.push(
                    ...getContentChangesetNodeDecorations({
                        doc: renderedDoc,
                        from,
                        to,
                        className: contentStyles.contentChangesetDeletedClassName,
                        nodeTypeName: "mention",
                    }),
                );
            }

            if (tableCellDecorations.length === 0) {
                // Empty blocks have no inline content to wrap in a `<del>` element.
                if (startDoc.textBetween(changeRange.fromA, changeRange.toA, "") === "") {
                    decorations.push({
                        type: "Node",
                        from,
                        to,
                        attrs: {class: contentStyles.contentChangesetDeletedClassName},
                    });
                } else {
                    decorations.push({
                        type: "Inline",
                        from,
                        to,
                        attrs: {
                            nodeName: "del",
                            class: contentStyles.contentChangesetDeletedClassName,
                        },
                    });
                }
            }

            renderedChangeRange = changeRange;
            break;
        }

        renderedChangeRanges.push(renderedChangeRange);
    }

    for (const changeRange of renderedChangeRanges) {
        if (changeRange.fromB >= changeRange.toB) continue;

        const from = endDocToRenderedDocMapping.map(changeRange.fromB, 1);
        const to = endDocToRenderedDocMapping.map(changeRange.toB, 1);
        const tableCellDecorations = getContentChangesetNodeDecorations({
            doc: renderedDoc,
            from,
            to,
            className: contentStyles.contentChangesetInsertedTableCellClassName,
            nodeTypeName: "tableCell",
        });

        decorations.push(...tableCellDecorations);

        if (endDoc.textBetween(changeRange.fromB, changeRange.toB, "") !== "") {
            decorations.push(
                ...getContentChangesetNodeDecorations({
                    doc: renderedDoc,
                    from,
                    to,
                    className: contentStyles.contentChangesetInsertedClassName,
                    nodeTypeName: "mention",
                }),
            );
        }

        if (tableCellDecorations.length === 0) {
            // Empty blocks likewise need a node decoration instead of an `<ins>` element.
            if (endDoc.textBetween(changeRange.fromB, changeRange.toB, "") === "") {
                decorations.push({
                    type: "Node",
                    from,
                    to,
                    attrs: {class: contentStyles.contentChangesetInsertedClassName},
                });
            } else {
                decorations.push({
                    type: "Inline",
                    from,
                    to,
                    attrs: {
                        nodeName: "ins",
                        class: contentStyles.contentChangesetInsertedClassName,
                    },
                });
            }
        }
    }

    return {
        endDoc,
        renderedDoc,
        decorations,
        hasOnlyCoverChanges:
            steps.length > 0 &&
            steps.every(step => step instanceof DocAttrStep && step.attr === "cover"),
    };
}

/**
 * Detects a pure top-level block insertion that an automated editor persisted by
 * shifting a list one item at a time.
 *
 * Let's say we have a list of dates, one paragraph each, top down. If we insert
 * `Aug 18` to the top of the list, the steps become:
 *
 * 1. Replace the `Aug 17` paragraph with `Aug 18`.
 * 2. Replace `Aug 14` with `Aug 17`, and `Aug 13` with `Aug 14`.
 * 3. Append a new `Aug 13` paragraph.
 *
 * The first two operations are same-sized replacements.
 *
 * Their step maps show no insertion; only the final append has an insertion map.
 * `ChangeSet` follows those maps, so it marks the trailing `Aug 3` as new rather
 * than the actual `Aug 18` insertion.
 *
 * For this specific shape, align the document's direct child nodes by semantic
 * equality instead.
 *
 * If every old child remains unchanged and the only difference is added children,
 * the resulting ranges identify the actual inserted blocks.
 *
 * This is intentionally a strict fallback rather than a general document diff: it
 * requires a same-sized replacement, at least one addition, and no removals. A
 * real edit, deletion, or other ambiguous update returns `null` so callers use the
 * normal step-map-based `ChangeSet` ranges instead.
 */
function getSemanticTopLevelInsertionRanges({
    startDoc,
    endDoc,
    steps,
}: {
    startDoc: Node;
    endDoc: Node;
    steps: ReadonlyArray<Step>;
}): Array<ContentChangesetRange> | null {
    if (
        !steps.some(
            step =>
                step instanceof ReplaceStep &&
                step.from < step.to &&
                step.to - step.from === step.slice.size,
        )
    ) {
        return null;
    }

    const changes = diff(startDoc.content.content, endDoc.content.content, {
        equals: (node1, node2) => node1.eq(node2),
    });

    if (!changes.some(change => change.type === "Added")) return null;
    if (changes.some(change => change.type === "Removed")) return null;

    const ranges: Array<ContentChangesetRange> = [];
    let startPosition = 0;
    let endPosition = 0;

    for (const change of changes) {
        switch (change.type) {
            case "Added":
                ranges.push({
                    fromA: startPosition,
                    toA: startPosition,
                    fromB: endPosition,
                    toB: endPosition + change.newToken.nodeSize,
                });
                endPosition += change.newToken.nodeSize;
                break;
            case "Equal":
                startPosition += change.oldToken.nodeSize;
                endPosition += change.newToken.nodeSize;
                break;
            case "Removed":
                return null;
            default:
                throw exhaustive(change);
        }
    }

    return ranges;
}

function getContentChangesetNodeDecorations({
    doc,
    from,
    to,
    className,
    nodeTypeName,
}: {
    doc: Node;
    from: number;
    to: number;
    className: string;
    nodeTypeName: string;
}): Array<ContentChangesetNodeDecoration> {
    const nodeDecorations: Array<ContentChangesetNodeDecoration> = [];

    doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === nodeTypeName && from <= pos && pos + node.nodeSize <= to) {
            nodeDecorations.push({
                type: "Node",
                from: pos,
                to: pos + node.nodeSize,
                attrs: {class: className},
            });
        }
    });

    return nodeDecorations;
}

/**
 * Collapses changes that overlap in either document coordinate space into one
 * replacement range.
 */
function mergeContentChangesetRanges(
    ranges: ReadonlyArray<ContentChangesetRange>,
): Array<ContentChangesetRange> {
    const mergedRanges: Array<ContentChangesetRange> = [];

    for (const range of [...ranges].sort((range1, range2) => range1.fromB - range2.fromB)) {
        let mergedRange = range;
        let rangeIndex = 0;

        while (rangeIndex < mergedRanges.length) {
            const existingRange = mergedRanges[rangeIndex];
            assert(existingRange);
            if (!doContentChangesetRangesOverlap(existingRange, mergedRange)) {
                rangeIndex += 1;
                continue;
            }

            mergedRange = {
                fromA: Math.min(existingRange.fromA, mergedRange.fromA),
                toA: Math.max(existingRange.toA, mergedRange.toA),
                fromB: Math.min(existingRange.fromB, mergedRange.fromB),
                toB: Math.max(existingRange.toB, mergedRange.toB),
            };
            mergedRanges.splice(rangeIndex, 1);
            // The expanded range can now overlap an earlier range.
            rangeIndex = 0;
        }

        mergedRanges.push(mergedRange);
    }

    return mergedRanges.sort((range1, range2) => range1.fromB - range2.fromB);
}

/** Returns whether two changes overlap in the start or end document. */
function doContentChangesetRangesOverlap(
    range1: ContentChangesetRange,
    range2: ContentChangesetRange,
): boolean {
    return (
        (range1.fromA <= range2.toA && range2.fromA <= range1.toA) ||
        (range1.fromB <= range2.toB && range2.fromB <= range1.toB)
    );
}

/**
 * Expands a change to its text-block boundaries when it fully replaces one text
 * block in both documents.
 */
function expandContentChangesetRangeToWholeTextBlocks({
    range,
    startDoc,
    endDoc,
}: {
    range: ContentChangesetRange;
    startDoc: Node;
    endDoc: Node;
}): ContentChangesetRange {
    const startDocBlockRange = getContentChangesetWholeTextBlockRange(
        startDoc,
        range.fromA,
        range.toA,
    );
    const endDocBlockRange = getContentChangesetWholeTextBlockRange(endDoc, range.fromB, range.toB);
    if (!startDocBlockRange || !endDocBlockRange) return range;

    return {
        fromA: startDocBlockRange.from,
        toA: startDocBlockRange.to,
        fromB: endDocBlockRange.from,
        toB: endDocBlockRange.to,
    };
}

/**
 * Returns the enclosing text block when a range covers all of its content.
 */
function getContentChangesetWholeTextBlockRange(doc: Node, from: number, to: number) {
    const $from = doc.resolve(from);
    const $to = doc.resolve(to);
    if (
        $from.depth === 0 ||
        $from.depth !== $to.depth ||
        $from.parent !== $to.parent ||
        !$from.parent.isTextblock ||
        $from.parentOffset !== 0 ||
        $to.parentOffset !== $to.parent.content.size
    ) {
        return null;
    }

    return {from: $from.before($from.depth), to: $to.after($to.depth)};
}
