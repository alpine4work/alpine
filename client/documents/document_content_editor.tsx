import {useEffect, useRef} from "react";
import {ContentEditor} from "~/client/content/content_editor";
import {documentContentClassName} from "~/client/documents/document_content_view";
import {useDocumentContentEditorState} from "~/client/documents/internal/document_content_editor_state";
import {DocumentContent} from "~/shared/content/document_content_schema";
import {DocumentModel} from "~/shared/models/document_model";

export function DocumentContentEditor({
    document,
    onDocumentContentChange,
}: {
    document: DocumentModel;
    onDocumentContentChange?: (content: DocumentContent) => void;
}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different id + version is passed in then remount
            // our stateful content editor component.
            key={`${document.id}-${document.version}`}
            initialDocument={document}
            onDocumentContentChange={onDocumentContentChange}
        />
    );
}

function DocumentContentEditorStateful({
    initialDocument,
    onDocumentContentChange,
}: {
    initialDocument: DocumentModel;
    onDocumentContentChange?: (content: DocumentContent) => void;
}) {
    const {editorState, onChangeEditorState, phantomSelections} =
        useDocumentContentEditorState(initialDocument);

    const content = editorState.getContent().doc;
    const lastContentRef = useRef(content);
    useEffect(() => {
        if (content !== lastContentRef.current) {
            onDocumentContentChange?.(content);
            lastContentRef.current = content;
        }
    }, [content, onDocumentContentChange]);

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
