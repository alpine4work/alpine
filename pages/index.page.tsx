import Head from "next/head";
import {useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";

export default function Home() {
    const [state, setState] = useState(() => ContentEditorState.create());

    return (
        <>
            <Head>
                <title>Cyberworlds</title>
            </Head>
            <main>
                <h1>Content editor</h1>
                <ContentEditor
                    state={state}
                    onChange={setState}
                    aria-label="Content editor"
                    placeholder="Type stuff here…"
                />
            </main>
        </>
    );
}
