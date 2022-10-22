import {sprinkles} from "~/client/design/sprinkles.css";
import {DocumentContentEditor} from "~/client/documents/document-content-editor";
import {createPageComponent} from "~/client/helpers/pages/create-page-component";
import {readDocument} from "~/server/dynamo/documents-table";
import {createGetServerSideProps} from "~/server/helpers/pages/create-get-server-side-props";
import {DocumentModel} from "~/shared/documents/document-model";
import {Schema} from "~/shared/schema/schema";

const Page = createPageComponent({
    query: Schema.object({
        documentId: Schema.id,
    }),
    props: Schema.object({
        document: DocumentModel.schema(),
    }),
    component: function DocumentPage({document: initialDocument}) {
        return (
            <main className={sprinkles({height: "full"})}>
                <DocumentContentEditor initialDocument={initialDocument} />
            </main>
        );
    },
});

export const getServerSideProps = createGetServerSideProps(Page, async context => {
    const document = await readDocument(context.query.documentId);
    if (!document) return {notFound: true};
    return {props: {document}};
});

export default Page;
