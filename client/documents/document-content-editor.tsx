import Head from "next/head";
import {useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";

export function DocumentContentEditor({initialDocument}: {initialDocument: DocumentModel}) {
    const [state, setState] = useState(() => ContentEditorState.create(initialDocument.content));

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.getContent())}</title>
            </Head>
            <ContentEditor
                state={state}
                onChange={setState}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
            />
        </>
    );
}
