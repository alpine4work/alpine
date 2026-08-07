import {Node} from "prosemirror-model";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";

/**
 * Helper for extracting information from a ProseMirror document in an incremental
 * way that stays speedy across document changes. Provides a similar API to
 * `Array.reduce()` for convenience but immutability of `Value` shouldn't matter.
 *
 * Takes advantage of the fact that ProseMirror's model are immutable objects that
 * use structural sharing. So when the document updates we can use previously
 * cached values for nodes that didn't change.
 *
 * You have to be smart in your usage of this helper to get performance benefits.
 * Do the bulk of your work in the function that only accepts `Node` since that's
 * what gets cached! The returned function with signature
 * `(value: Value, doc: Node, offset: number) => Value` will be called on every
 * document update! Return null when you won't care about the node (we will still
 * visit the node's children).
 *
 * We have this two function system because while `Node` objects are immutable and
 * won't change across document updates, their position in the document might
 * change. Some text may be typed above which changes the offset. So the cacheable
 * work is based on the `Node` and you may need to adjust your result based on the
 * position of the node in the document.
 */
export function createProsemirrorIncrementalReducer<Value>(
    createReducer: (node: Node) => ((value: Value, doc: Node, offset: number) => Value) | null,
): (value: Value, doc: Node) => Value {
    const cache = new WeakMap<Node, ((value: Value, doc: Node, offset: number) => Value) | null>();

    const traverse = (node: Node) =>
        getOrSetDefaultMapValue(cache, node, () => {
            const reducer = createReducer(node);

            const segments: Array<
                | {
                      type: "Child";
                      node: Node;
                      reducer: (value: Value, doc: Node, offset: number) => Value;
                  }
                | {
                      type: "Skipped";
                      nodeSize: number;
                  }
            > = [];

            // NOTE(calebmer): Idle observation: If instead of representing a node's children
            // as an array ProseMirror used a tree like `functional-red-black-tree` then we
            // could get even better structural sharing. Maybe better update performance as
            // well. As it stands, the root level of the document is a long array which
            // constantly needs to be recreated whenever anything changes.
            for (let childIndex = 0; childIndex < node.childCount; childIndex++) {
                const childNode = node.child(childIndex);
                const childReducer = traverse(childNode);

                if (childReducer !== null) {
                    segments.push({
                        type: "Child",
                        node: childNode,
                        reducer: childReducer,
                    });
                } else {
                    const lastSegment = segments[segments.length - 1];
                    if (lastSegment && lastSegment.type === "Skipped") {
                        lastSegment.nodeSize += childNode.nodeSize;
                    } else {
                        segments.push({
                            type: "Skipped",
                            nodeSize: childNode.nodeSize,
                        });
                    }
                }
            }

            // Optimization: If every child is skipped then this node has no reducer.
            if (!reducer && segments.every(segment => segment.type === "Skipped")) return null;

            return (value, doc, offset) => {
                if (reducer) value = reducer(value, doc, offset);

                offset += 1;

                for (const segment of segments) {
                    if (segment.type === "Child") {
                        value = segment.reducer(value, doc, offset);
                        offset += segment.node.nodeSize;
                    } else {
                        offset += segment.nodeSize;
                    }
                }

                return value;
            };
        });

    return (value, doc) => traverse(doc)?.(value, doc, -1) ?? value;
}
