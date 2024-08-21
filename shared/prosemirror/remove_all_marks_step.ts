import {Mark, Node} from "prosemirror-model";
import {AddMarkStep, Mappable, Step, StepResult} from "prosemirror-transform";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";

/**
 * Remove all marks that match the provided mark object in the document. No
 * matter their location.
 *
 * Used to resolve comment threads in a way that is collaboration-safe. In case
 * another user is typing and changes the range of a comment in a way that
 * won't quite be mapped correctly against the range of the comment at the
 * version you dismissed at.
 *
 * Note that we don't have `fromJSON()` method implementations or a
 * corresponding `Step.jsonID()` step call. That's because whenever we're
 * parsing steps from JSON it's with a `Schema` created by
 * `createSchemaForProsemirrorSchema()` which knows about this step type.
 * Registering our class with `Step.jsonID()` causes issues with hot reloading.
 * Since this module may be evaluated multiple times but we can only register
 * in `prosemirror-transform` once.
 */
export class RemoveAllMarksStep extends Step {
    public readonly mark: Mark;

    constructor(mark: Mark) {
        super();
        this.mark = mark;
    }

    public override apply(doc: Node) {
        const remove = (node: Node): Node => {
            if (node.isInline) {
                return node.mark(this.mark.removeFromSet(node.marks));
            }

            let newChildren: Array<Node> | null = null;

            for (let i = 0; i < node.childCount; i++) {
                const oldChildNode = node.child(i);
                const newChildNode = remove(oldChildNode);

                // If our child node changed then initialize the new children array so we
                // return a new node...
                if (newChildNode !== oldChildNode && newChildren === null) {
                    newChildren = [];
                    for (let j = 0; j < i; j++) {
                        newChildren.push(node.child(j));
                    }
                }

                if (newChildren !== null) {
                    newChildren.push(newChildNode);
                }
            }

            if (newChildren === null) return node;

            return node.type.create(node.attrs, newChildren, node.marks);
        };

        return StepResult.ok(remove(doc));
    }

    public override invert(doc: Node) {
        const ranges: Array<{from: number; to: number}> = [];

        const collectRanges = (pos: number, node: Node) => {
            if (node.isInline) {
                if (this.mark.isInSet(node.marks)) {
                    ranges.push({from: pos, to: pos + node.nodeSize});
                }
            } else {
                pos += 1;

                for (let i = 0; i < node.childCount; i++) {
                    const childNode = node.child(i);
                    collectRanges(pos, childNode);
                    pos += childNode.nodeSize;
                }
            }
        };

        collectRanges(-1, doc);

        return new AddMarksAfterRemoveAllStep(this.mark, ranges);
    }

    public override map() {
        return new RemoveAllMarksStep(this.mark);
    }

    public override toJSON() {
        return {
            stepType: "removeAllMarks",
            mark: this.mark.toJSON(),
        };
    }
}

/**
 * A step to act as the inverse of `RemoveAllMarksStep`. Adds multiple
 * instances of a mark throughout the document.
 *
 * Note that we don't have `fromJSON()` method implementations or a
 * corresponding `Step.jsonID()` step call. That's because whenever we're
 * parsing steps from JSON it's with a `Schema` created by
 * `createSchemaForProsemirrorSchema()` which knows about this step type.
 * Registering our class with `Step.jsonID()` causes issues with hot reloading.
 * Since this module may be evaluated multiple times but we can only register
 * in `prosemirror-transform` once.
 */
export class AddMarksAfterRemoveAllStep extends Step {
    public readonly mark: Mark;
    public readonly ranges: ReadonlyArray<{
        readonly from: number;
        readonly to: number;
    }>;

    constructor(
        mark: Mark,
        ranges: ReadonlyArray<{
            readonly from: number;
            readonly to: number;
        }>,
    ) {
        super();
        this.mark = mark;
        this.ranges = ranges;
    }

    public override apply(doc: Node) {
        return this.ranges.reduce((stepResult, range) => {
            if (!stepResult.doc) return stepResult;
            return new AddMarkStep(range.from, range.to, this.mark).apply(stepResult.doc);
        }, StepResult.ok(doc));
    }

    public override invert() {
        return new RemoveAllMarksStep(this.mark);
    }

    public override map(mapping: Mappable) {
        const ranges = filterMapArray(this.ranges, range => {
            const from = mapping.mapResult(range.from, 1);
            const to = mapping.mapResult(range.to, -1);
            if ((from.deleted && to.deleted) || from.pos >= to.pos) return null;
            return {from: from.pos, to: to.pos};
        });

        if (ranges.length === 0) return null;
        return new AddMarksAfterRemoveAllStep(this.mark, ranges);
    }

    public override toJSON() {
        return {
            stepType: "addMarksAfterRemoveAll",
            mark: this.mark.toJSON(),
            ranges: this.ranges,
        };
    }
}
