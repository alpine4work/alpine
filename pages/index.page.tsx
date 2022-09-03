import Head from "next/head";
import {useEffect, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {Box} from "~/client/design/box";
import {ContentSchema} from "~/shared/content/content-schema";

export default function Home() {
    const [state, setState] = useState(() => ContentEditorState.create());

    useEffect(() => {
        const indexContentJson = localStorage.getItem("indexContentJson");
        if (!indexContentJson) {
            setState(ContentEditorState.create());
        } else {
            setState(
                ContentEditorState.create(ContentSchema.nodeFromJSON(JSON.parse(indexContentJson))),
            );
        }
    }, []);

    return (
        <>
            <Head>
                <title>Cyberworlds</title>
            </Head>
            <main>
                <Box width="full" display="flex" justifyContent="center">
                    <Box width="full" maxWidth="192">
                        <h1>Content editor</h1>
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
                        />
                    </Box>
                </Box>
            </main>
        </>
    );
}
