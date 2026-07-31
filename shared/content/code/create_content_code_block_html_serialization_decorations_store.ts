import {highlightTree} from "@lezer/highlight";
import {Node} from "prosemirror-model";
import {contentCodeBlockLanguageById} from "~/shared/content/code/content_code_block_language.js";
import {createContentCodeBlockNodeInput} from "~/shared/content/code/create_content_code_block_node_input.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

export type ContentCodeBlockHtmlSerializationDecoration = {
    readonly type: "Inline";
    readonly from: number;
    readonly to: number;
    readonly attrs: {
        readonly nodeName: "span";
        readonly class: string;
    };
};

/**
 * Generate `codeBlock` node syntax highlighting decorations for `<ContentView>`'s
 * ProseMirror HTML serialization and add them to the `decorations` array.
 *
 * Performs the same logic as `ContentCodeBlockIncrementalParser` but in one shot.
 * Doesn't save state for future incremental parses.
 */
export function createContentCodeBlockHtmlSerializationDecorationsStore(
    doc: Node,
): Store<ReadonlyArray<ContentCodeBlockHtmlSerializationDecoration>> {
    return computeStore(get => {
        const decorations: Array<ContentCodeBlockHtmlSerializationDecoration> = [];

        doc.forEach((node, offset) => {
            // Currently, code blocks may only be a direct child of `doc`.
            if (node.type.name !== "codeBlock") return;

            const languageId: ContentCodeBlockLanguageId = node.attrs.language ?? "text";
            const language = contentCodeBlockLanguageById[languageId];
            const parserPromiseStore = language.getParser();
            if (parserPromiseStore === null) return;

            const parserPromise = get(parserPromiseStore);
            if (parserPromise.status === "pending") return;
            if (parserPromise.status === "rejected") throw parserPromise.reason;

            const parser = parserPromise.value;

            const input = createContentCodeBlockNodeInput(node);
            const tree = parser.parse(input);

            // `length` corresponds to the current position in the input string. It's different
            // from the ProseMirror position `pos` in that for `pos` each line adds 2 (the
            // start + end of the node) whereas for `length` each line adds 1 (a `\n`
            // character).
            let length = 0;
            let pos = 0;

            for (const lineNode of node.content.content) {
                const lineFrom = length;
                const lineTo = lineFrom + lineNode.content.size + 1;
                const lengthToPos = pos - length;
                length = lineTo;
                pos += lineNode.nodeSize;

                highlightTree(
                    tree,
                    lezerClassHighlighter.get(),
                    (from, to, classes) => {
                        decorations.push({
                            type: "Inline",
                            from: offset + 2 + from + lengthToPos,
                            to: offset + 2 + to + lengthToPos,
                            attrs: {nodeName: "span", class: classes},
                        });
                    },
                    lineFrom,
                    lineTo,
                );
            }
        });

        return decorations;
    });
}
