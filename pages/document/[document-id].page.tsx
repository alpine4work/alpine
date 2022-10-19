import Head from "next/head";
import {useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {createPageComponent} from "~/client/helpers/pages/create-page-component";
import {readDocument} from "~/server/dynamo/documents-table";
import {createGetServerSideProps} from "~/server/helpers/pages/create-get-server-side-props";
import {
    DocumentContentProsemirrorSchema,
    DocumentContentSchema,
    emptyDocumentContent,
} from "~/shared/content/document-content-schema";
import {Schema} from "~/shared/schema/schema";

const Page = createPageComponent({
    query: Schema.object({
        documentId: Schema.id,
    }),
    props: Schema.object({
        document: Schema.object({
            id: Schema.id,
            title: Schema.string,
            version: Schema.integer,
            content: DocumentContentSchema,
        }).nullable(),
    }),
    component: function DocumentPage({document}) {
        const [state, setState] = useState(() =>
            ContentEditorState.create({
                schema: DocumentContentProsemirrorSchema,
                content: document?.content ?? emptyDocumentContent,
            }),
        );

        // TODO(calebmer): Get title from content?
        const title = document && document.title.trim().length > 0 ? document.title : "Untitled";

        return (
            <>
                <Head>
                    <title>{title}</title>
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
    return {props: {document}};
});

export default Page;
