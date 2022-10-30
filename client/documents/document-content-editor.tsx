import Head from "next/head";
import {ContentEditor} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {useDocumentContentEditorAblyContentSync} from "~/client/documents/document-content-editor-ably";
import {useDocumentContentEditorDurableObjectSync} from "~/client/documents/document-content-editor-do";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";

const durableObjectsEnabled = true;

const useContentSync = durableObjectsEnabled
    ? useDocumentContentEditorDurableObjectSync
    : useDocumentContentEditorAblyContentSync;

export function DocumentContentEditor({document}: {document: DocumentModel}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different id+version is passed in then remount our
            // stateful content editor component.
            key={`${document.id}.${document.version}`}
            initialDocument={document}
        />
    );
}

function DocumentContentEditorStateful({initialDocument}: {initialDocument: DocumentModel}) {
    const {phantomTextSelections, editorState, onEdit} = useContentSync(initialDocument);

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={editorState}
                onChange={onEdit}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
                phantomTextSelections={phantomTextSelections}
            />
        </>
    );
}
