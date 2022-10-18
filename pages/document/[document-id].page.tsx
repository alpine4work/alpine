import {GetServerSidePropsContext, GetServerSidePropsResult} from "next";
import Head from "next/head";
import {ComponentProps, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {Document, readDocument} from "~/server/dynamo/documents-table";
import {
    DocumentContentProsemirrorSchema,
    emptyDocumentContent,
} from "~/shared/content/document-content-schema";
import {isId} from "~/shared/id/id";

export async function getServerSideProps(
    context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<ComponentProps<typeof DocumentPage>>> {
    const documentId = context.query["document-id"];
    const document =
        typeof documentId === "string" && isId(documentId) ? await readDocument(documentId) : null;
    return {props: {document}};
}

export default function DocumentPage({document}: {document: Document | null}) {
    const [state, setState] = useState(() =>
        ContentEditorState.create({
            schema: DocumentContentProsemirrorSchema,
            content: document?.content ?? emptyDocumentContent,
        }),
    );

    return (
        <>
            <Head>
                <title>Cyberworlds</title>
            </Head>
            <main className={sprinkles({height: "full"})}>
                <ContentEditor
                    state={state}
                    onChange={setState}
                    aria-label="Content editor"
                    placeholder="Share your ideas…"
                    className={sprinkles({paddingBottom: "24"})}
                />
            </main>
        </>
    );
}
