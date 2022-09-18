import Head from "next/head";
import {useEffect, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {
    DocumentContentProsemirrorSchema,
    emptyDocumentContent,
} from "~/shared/content/document-content-prosemirror-schema";

export default function Home() {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            schema: DocumentContentProsemirrorSchema,
            content: emptyDocumentContent,
        }),
    );

    useEffect(() => {
        const indexContentJson = localStorage.getItem("indexContentJson");
        if (!indexContentJson) {
            setState(
                ContentEditorState.create({
                    schema: DocumentContentProsemirrorSchema,
                    content: emptyDocumentContent,
                }),
            );
        } else {
            setState(
                ContentEditorState.create({
                    schema: DocumentContentProsemirrorSchema,
                    content: DocumentContentProsemirrorSchema.nodeFromJSON(
                        JSON.parse(indexContentJson),
                    ),
                }),
            );
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
                            JSON.stringify(state.doc.toJSON()),
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
