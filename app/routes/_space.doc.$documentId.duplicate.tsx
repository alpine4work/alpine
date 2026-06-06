import {useParams, useSearchParams} from "@remix-run/react";
import {useCallback, useMemo} from "react";
import {deserializeDocumentIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {ContentDuplicationView} from "~/client/web/content/with_navigation/content_duplication_view.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {authorizeDocumentAccess} from "~/server/documents/data/documents_actions.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    ContentDuplicationVariableValues,
    decodeContentDuplicationVariableSchemaFromUrl,
} from "~/shared/content/content_duplication_variable_schema.js";
import {addFallbackToDocumentTitle} from "~/shared/documents/document_model.js";
import {duplicateDocument} from "~/shared/rpc/documents_rpc_definitions.js";

/**
 * Route for duplicating a document with template variable replacement. Schema and
 * title are encoded in the URL search params. Opens as a peek when navigated to.
 */
export async function loader({params, context: unauthenticatedContext}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const documentId = deserializeDocumentIdForLoader(params.documentId);
    await authorizeDocumentAccess(context, documentId, "View");
    return null;
}

export default function DocumentDuplicateRoute() {
    const context = useAppContext();
    const params = useParams();
    const [searchParams] = useSearchParams();

    const documentId = deserializeDocumentIdForLoader(params.documentId);

    const title = searchParams.get("title") ?? "";

    const variableSchema = useMemo(
        () => decodeContentDuplicationVariableSchemaFromUrl(searchParams.get("schema")),
        [searchParams],
    );

    const handleDuplicate = useCallback(
        async (variableValues: ContentDuplicationVariableValues) => {
            const {documentId: newDocumentId} = await duplicateDocument(context, {
                sourceDocumentId: documentId,
                variableValues,
            });
            return `/doc/${newDocumentId}`;
        },
        [context, documentId],
    );

    return (
        <ContentDuplicationView
            title={addFallbackToDocumentTitle(title)}
            defaultPreviousRoute={`/doc/${documentId}`}
            variableSchema={variableSchema}
            onDuplicate={handleDuplicate}
        />
    );
}
