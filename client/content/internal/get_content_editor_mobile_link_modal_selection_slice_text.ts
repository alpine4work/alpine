import {Slice} from "prosemirror-model";
import {printContentSingleLineTextSnippetForClient} from "~/client/content/print_content_single_line_text_snippet_for_client.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";

/**
 * Is the slice (from a selection) editable? Returns a single line of text from
 * the selection regardless of whether it's editable or not. If the text spans
 * multiple nodes then we print a single line of text with
 * `printContentSingleLineTextSnippet()`.
 */
export function getContentEditorMobileLinkModalSelectionSliceText(
    get: <Value>(store: Store<Value>) => Value,
    spaceId: SpaceId,
    selectionSlice: Slice,
    references: ContentReferences,
): {text: string; isEditable: boolean} {
    if (selectionSlice.content.childCount === 0) return {text: "", isEditable: true};

    const schema = selectionSlice.content.firstChild!.type.schema;

    let textNode =
        selectionSlice.content.childCount === 1 ? selectionSlice.content.firstChild! : null;
    if (textNode) {
        let count = selectionSlice.openStart;
        while (textNode && count > 0) {
            count--;
            textNode = textNode.content.childCount === 1 ? textNode.firstChild! : null;
        }
    }

    if (selectionSlice.openStart !== selectionSlice.openEnd || !textNode?.isText) {
        return {
            text: printContentSingleLineTextSnippetForClient(get, spaceId, {
                // Intentionally calling `create()` and not `createChecked()` since for some
                // schemas (e.g. documents) our slice may not match the expected schema.
                doc: schema.topNodeType.create({}, selectionSlice.content.content),
                references,
            }),
            isEditable: false,
        };
    }

    return {
        text: textNode.text!,
        isEditable: true,
    };
}
