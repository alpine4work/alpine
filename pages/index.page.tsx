import Head from "next/head";
import {useEffect, useState} from "react";
import {ContentEditor} from "~/client/content/content-editor";
import {ContentEditorState} from "~/client/content/content-editor-state";
import {sprinkles} from "~/client/design/sprinkles.css";
import {
    DocumentContentProsemirrorSchema,
    emptyDocumentContent,
    isDocumentContent,
} from "~/shared/documents/document-content-schema";
import {assert} from "~/shared/helpers/control/assert";

export default function Home() {
    const [state, setState] = useState(() => ContentEditorState.create(emptyDocumentContent));

    useEffect(() => {
        const indexContentJson = localStorage.getItem("indexContentJson");
        if (!indexContentJson) {
            setState(ContentEditorState.create(emptyDocumentContent));
        } else {
            const content = DocumentContentProsemirrorSchema.nodeFromJSON(
                JSON.parse(indexContentJson),
            );
            assert(isDocumentContent(content));
            setState(ContentEditorState.create(content));
        }
    }, []);

    return (
        <>
            <Head>
                <title>Cyberworlds</title>
            </Head>
            <main className={sprinkles({height: "full"})}>
                <ContentEditor
                    state={state}
                    onChange={state => {
                        localStorage.setItem(
                            "indexContentJson",
                            JSON.stringify(state.getContent().toJSON()),
                        );
                        setState(state);
                    }}
                    aria-label="Content editor"
                    placeholder="Share your ideas…"
                    className={sprinkles({paddingBottom: "24"})}
                />
            </main>
        </>
    );
}
