import {Input} from "@lezer/common";
import {Node} from "prosemirror-model";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Create an `Input` object for the Lezer parser from a code block node. We
 * leverage the fact that code block nodes are already split into individual lines
 * to produce an optimized chunking implementation.
 */
export function createContentCodeBlockNodeInput(node: Node): Input {
    assert(node.type.name === "codeBlock");

    // Each `codeBlockLine` adds 2 to `nodeSize`. Representing entering/exiting the
    // node. We want to insert a newline for each child so only subtract 1 for each
    // `codeBlockLine` node.
    const length = node.content.size - node.childCount * 1;

    return {
        length,

        // When this is true, the result of `chunk()` should either be a single line break,
        // or the content between `from` and the next line break.
        lineChunks: true,

        chunk: from => {
            let length = 0;

            for (let i = 0; i < node.content.content.length; i++) {
                const lineNode = node.content.content[i]!;

                if (
                    lineNode.content.size > 0 &&
                    length <= from &&
                    from < length + lineNode.content.size
                ) {
                    return lineNode.content.textBetween(
                        from - length,
                        lineNode.content.size,
                        null,
                        // Non-text nodes have size of 1 in ProseMirror's model. Treat them as 1 space
                        // character. Syntax highlighting for most languages will skip them.
                        //
                        // NOTE(calebmer, 2024-07-11): Currently we don't allow any non-text nodes in code
                        // blocks (no mentions) but we may allow them in the future.
                        " ",
                    );
                }

                length += lineNode.content.size;

                if (from === length) {
                    return "\n";
                }

                length += 1;
            }

            return "";
        },
        read: (from, to) => {
            assert(from <= to);

            let length = 0;
            let text = "";

            for (let i = 0; i < node.content.content.length; i++) {
                const lineNode = node.content.content[i]!;

                if (
                    lineNode.content.size > 0 &&
                    from <= length + lineNode.content.size &&
                    to >= length
                ) {
                    text += lineNode.content.textBetween(
                        Math.max(0, from - length),
                        Math.min(lineNode.content.size, to - length),
                        null,
                        // Non-text nodes have size of 1 in ProseMirror's model. Treat them as 1 space
                        // character. Syntax highlighting for most languages will skip them.
                        //
                        // NOTE(calebmer, 2024-07-11): Currently we don't allow any non-text nodes in code
                        // blocks (no mentions) but we may allow them in the future.
                        " ",
                    );
                }

                length += lineNode.content.size;

                if (from <= length && length < to) {
                    text += "\n";
                }

                length += 1;

                if (length >= to) return text;
            }

            return text;
        },
    };
}
