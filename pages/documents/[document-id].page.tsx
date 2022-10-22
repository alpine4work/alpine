import Head from "next/head";
import {useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {createPageComponent} from "~/client/helpers/pages/create-page-component";
import {readDocument} from "~/server/dynamo/documents-table";
import {createGetServerSideProps} from "~/server/helpers/pages/create-get-server-side-props";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {Schema} from "~/shared/schema/schema";

const Page = createPageComponent({
    query: Schema.object({
        documentId: Schema.id,
    }),
    props: Schema.object({
        document: DocumentModel.schema(),
    }),
    component: function DocumentPage({document: initialDocument}) {
        const [state, setState] = useState(() =>
            ContentEditorState.create(initialDocument.content),
        );

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
