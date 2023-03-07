import {ContentEditor} from "~/client/content/content_editor";
import {documentContentClassName} from "~/client/documents/document_content_view";
import {useDocumentContentEditorState} from "~/client/documents/internal/document_content_editor_state";
import {DocumentModel} from "~/shared/models/document_model";

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
    const {editorState, onChangeEditorState, phantomSelections} =
        useDocumentContentEditorState(initialDocument);

    return (
        <ContentEditor
            state={editorState}
            onChange={onChangeEditorState}
            aria-label="Document"
            placeholder="Share your ideas…"
            className={documentContentClassName}
            phantomSelections={phantomSelections}
        />
    );
}
