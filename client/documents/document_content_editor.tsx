import {useNavigate} from "react-router-dom";
import {ContentEditor} from "~/client/content/content_editor";
import {useDocumentContentEditorState} from "~/client/documents/internal/document_content_editor_state";
import {DocumentModel} from "~/shared/documents/document_model";
import {sprinkles} from "~/shared/styles/styles";

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
            onNavigate={useNavigate()}
            aria-label="Document content"
            placeholder="Share your ideas…"
            className={sprinkles({paddingBottom: "24"})}
            phantomSelections={phantomSelections}
        />
    );
}
