import {Slice} from "prosemirror-model";
import {EditorView, __serializeForClipboard as serializeForClipboard} from "prosemirror-view";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {writeTextToClipboardFallback} from "~/client/helpers/write_text_to_clipboard.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Write some content including its rich styles to the clipboard.
 */
export async function writeContentToClipboard(
    spaceId: SpaceId,
    content: ContentWithReferences,
    fileAttachmentTarget: FileAttachmentTarget | null,
    slice: Slice = content.doc.slice(0),
) {
    const state = ContentEditorState.create(content)._getInternalState();
    const {schema} = state.doc.type;

    const view = new EditorView(null, {
        state,
        domParser: ContentEditorDomParser.fromSchema(schema),
        clipboardSerializer: ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
            schema,
            () => spaceId,
            () => content.references,
            () => assertExists(fileAttachmentTarget),
        ),
        clipboardTextSerializer: slice =>
            contentEditorTextClipboardSerializer(
                slice,
                () => spaceId,
                () => content.references,
            ),
    });

    const {dom, text} = serializeForClipboard(view, slice);

    // If there is no `navigator.clipboard` (e.g. in Safari) then write text only
    // with our fallback.
    if (!navigator.clipboard) {
        writeTextToClipboardFallback(text);
    } else {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([dom.innerHTML], {type: "text/html"}),
                "text/plain": new Blob([text], {type: "text/plain"}),
            }),
        ]);
    }
}
