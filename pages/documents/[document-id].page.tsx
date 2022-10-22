import Head from "next/head";
import {useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {createPageComponent} from "~/client/helpers/pages/create-page-component";
import {readDocument} from "~/server/dynamo/documents-table";
import {createGetServerSideProps} from "~/server/helpers/pages/create-get-server-side-props";
import {DocumentContentSchema} from "~/shared/documents/document-content-schema";
import {getDocumentContentTitle} from "~/shared/documents/document-title";
import {Schema} from "~/shared/schema/schema";

const Page = createPageComponent({
    query: Schema.object({
        documentId: Schema.id,
    }),
    props: Schema.object({
        document: Schema.object({
            id: Schema.id,
            version: Schema.integer,
            content: DocumentContentSchema,
        }),
    }),
    component: function DocumentPage({document}) {
        const [state, setState] = useState(() => ContentEditorState.create(document.content));

        return (
            <>
                <Head>
                    <title>{getDocumentContentTitle(state.getContent())}</title>
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
    },
});

export const getServerSideProps = createGetServerSideProps(Page, async context => {
    const document = await readDocument(context.query.documentId);
    if (!document) return {notFound: true};
    return {props: {document}};
});

export default Page;
