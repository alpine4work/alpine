import {EditorView, serializeForClipboard} from "prosemirror-view";
import {getAccountClientStoreForClient} from "~/client/accounts/account_client_store_context_provider.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentEditorDomParser} from "~/client/content/internal/content_editor_dom_parser.js";
import {contentEditorTextClipboardSerializer} from "~/client/content/internal/content_editor_text_clipboard_serializer.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";

/**
 * Write some content including its rich styles to the clipboard.
 */
export async function writeContentToClipboard(content: ContentWithReferences) {
    const state = ContentEditorState.create(content)._getInternalState();
    const {schema} = state.doc.type;

    const accountStore = getAccountClientStoreForClient();

    const view = new EditorView(null, {
        state,
        domParser: ContentEditorDomParser.fromSchema(schema),
        clipboardSerializer: ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
            schema,
            accountStore,
            () => content.references,
        ),
        clipboardTextSerializer: slice =>
            contentEditorTextClipboardSerializer(slice, accountStore, () => content.references),
    });

    const {dom, text} = serializeForClipboard(view, state.doc.slice(0));

    await navigator.clipboard.write([
        new ClipboardItem({
            "text/html": dom.innerHTML,
            "text/plain": text,
        }),
    ]);
}
