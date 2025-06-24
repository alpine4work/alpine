import {Schema as ProsemirrorSchema, Slice} from "prosemirror-model";
import {EditorState} from "prosemirror-state";
import {EditorView, __parseFromClipboard as parseFromClipboard} from "prosemirror-view";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Write some content including its rich styles to the clipboard.
 */
export function parseContentFromClipboard(
    spaceId: SpaceId,
    schema: ProsemirrorSchema,
    fileAttachmentTarget: FileAttachmentTarget | null,
    text: string,
    html: string | null,
    plainText: boolean,
): Slice | null {
    const references = emptyContentReferences;

    const view = new EditorView(null, {
        state: EditorState.create({doc: assertExists(schema.topNodeType.createAndFill())}),
        domParser: ContentEditorDomParser.fromSchema(schema),
        clipboardSerializer: ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
            schema,
            () => spaceId,
            () => references,
            () => assertExists(fileAttachmentTarget),
        ),
        clipboardTextSerializer: slice =>
            contentEditorTextClipboardSerializer(
                slice,
                () => spaceId,
                () => references,
            ),
    });

    return parseFromClipboard(view, text, html, plainText, view.state.doc.resolve(0));
}
