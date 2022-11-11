import {ContentEditor} from "~/client/content/content_editor";
import {useDocumentContentEditorDurableObjectSync} from "~/client/documents/document-content-editor-do";
import {useDocumentContentEditorAblyContentSync} from "~/client/documents/document_content_editor_ably";
import {DocumentModel} from "~/shared/documents/document_model";
import {sprinkles} from "~/shared/styles/styles";

const durableObjectsEnabled = true;

const useContentSync = durableObjectsEnabled
    ? useDocumentContentEditorDurableObjectSync
    : useDocumentContentEditorAblyContentSync;

export function DocumentContentEditor({document}: {document: DocumentModel}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different id + version is passed in then remount
            // our stateful content editor component.
            key={`${document.id}-${document.version}`}
            initialDocument={document}
        />
    );
}

function DocumentContentEditorStateful({initialDocument}: {initialDocument: DocumentModel}) {
    const {phantomTextSelections, editorState, onChangeEditorState} =
        useContentSync(initialDocument);

    return (
        <ContentEditor
            state={editorState}
            onChange={onChangeEditorState}
            aria-label="Document editor"
            placeholder="Share your ideas…"
            className={sprinkles({paddingBottom: "24"})}
            phantomTextSelections={phantomTextSelections}
        />
    );
}
