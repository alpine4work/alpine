import Head from "next/head";
import {ContentEditor} from "~/client/content/content-editor";
import {useDocumentContentEditorAblyContentSync} from "~/client/documents/document-content-editor-ably";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {sprinkles} from "~/shared/styles/styles";

export function DocumentContentEditor({document}: {document: DocumentModel}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different version is passed in then remount our
            // stateful content editor component.
            key={document.version}
            initialDocument={document}
        />
    );
}

function DocumentContentEditorStateful({initialDocument}: {initialDocument: DocumentModel}) {
    const {phantomTextSelections, editorState, onChangeEditorState} =
        useDocumentContentEditorAblyContentSync(initialDocument);

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={editorState}
                onChange={onChangeEditorState}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
                phantomTextSelections={phantomTextSelections}
            />
        </>
    );
}
