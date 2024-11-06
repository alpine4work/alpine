import {Box} from "~/client/design/box.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {DocumentContentView} from "~/client/documents/document_content_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {getDocument} from "~/server/documents/data/documents_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    document: DocumentModel.schema(),
});

export async function loader({params, context}: LoaderArgs) {
    const documentId = Schema.id<DocumentId>().deserialize(params.documentId ?? null);

    const document = await getDocument(await context.actor.authenticate(), documentId);

    const propagateEventData: TracerEventData = {
        context: {documentId},
    };

    return jsonWithSchema(LoaderSchema, {document}, {propagateEventData});
}

export const meta = createMetaFunction(LoaderSchema, ({data: {document}}) => [
    {title: document.getTitle()},
]);

export default function DocumentViewRoute({
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const {document} = useLoaderDataWithSchema(LoaderSchema);

    const isMobile = useIsMobile();
    const withMobileLayout = isMobile || withMobileLayoutProp;

    return (
        <Box
            ref={useScrollbar()}
            flexGrow="1"
            overflowX="hidden"
            overflowY="auto"
            position="relative"
            zIndex="0"
        >
            <DocumentContentView
                // Re-render when the document changes
                key={document.id}
                withMobileLayout={withMobileLayout}
                initialDocument={document}
            />
        </Box>
    );
}
