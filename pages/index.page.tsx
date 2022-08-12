import Head from "next/head";
import {useEffect, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {Box} from "~/client/design/box";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use-is-initial-app-render";
import {ContentSchema} from "~/shared/content/content-schema";

export default function Home() {
    const isInitialAppRender = useIsInitialAppRender();
    const [state, setState] = useState(() => ContentEditorState.create());

    useEffect(() => {
        if (isInitialAppRender) {
            const indexContentJson = localStorage.getItem("indexContentJson");
            if (!indexContentJson) {
                setState(ContentEditorState.create());
            } else {
                setState(
                    ContentEditorState.create(
                        ContentSchema.nodeFromJSON(JSON.parse(indexContentJson)),
                    ),
                );
            }
        }
    }, [isInitialAppRender]);

    useEffect(() => {
        if (!isInitialAppRender) {
            localStorage.setItem("indexContentJson", JSON.stringify(state.doc.toJSON()));
        }
    }, [isInitialAppRender, state.doc]);

    return (
        <>
            <Head>
                <title>Cyberworlds</title>
            </Head>
            <main>
                <Box width="full" display="flex" justifyContent="center">
                    <Box width="256">
                        <h1>Content editor</h1>
                        <ContentEditor
                            state={state}
                            onChange={setState}
                            aria-label="Content editor"
                            placeholder="Type stuff here…"
                        />
                    </Box>
                </Box>
            </main>
        </>
    );
}
