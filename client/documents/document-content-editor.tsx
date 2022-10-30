import Head from "next/head";
import {useReducer, useState} from "react";
import {ContentEditor} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {useDocumentContentEditorAblyContentSync} from "~/client/documents/document-content-editor-ably";
import {getInitialState, reduce} from "~/client/documents/document-content-editor-ably-state";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";

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
    const documentId = initialDocument.id;

    const [state, dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const {phantomTextSelections} = useDocumentContentEditorAblyContentSync(
        documentId,
        state,
        dispatch,
    );

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={state.editorState}
                onChange={editorState => dispatch({type: "Edit", editorState})}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
                phantomTextSelections={phantomTextSelections}
            />
        </>
    );
}
