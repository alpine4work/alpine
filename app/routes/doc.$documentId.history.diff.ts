import {deserializeDocumentIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {getDocumentHistoryDiff} from "~/server/documents/data/get_document_history_diff.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {DocumentHistoryDiffForRangeSchema} from "~/shared/documents/document_history_model.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";

export async function loader({params, context: unauthenticatedContext, request}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const documentId = deserializeDocumentIdForLoader(params.documentId);
    const searchParams = new URL(request.url).searchParams;
    const startVersion = getDocumentHistoryVersionSearchParam(searchParams, "startVersion");
    const endVersion = getDocumentHistoryVersionSearchParam(searchParams, "endVersion");
    const showInitialContentAsAdditions =
        searchParams.get("showInitialContentAsAdditions") === "true";

    return jsonWithSchema(DocumentHistoryDiffForRangeSchema, {
        range: {startVersion, endVersion},
        showInitialContentAsAdditions,
        diff: await getDocumentHistoryDiff(context, {
            id: documentId,
            startVersion,
            endVersion,
            showInitialContentAsAdditions,
        }),
    });
}

function getDocumentHistoryVersionSearchParam(searchParams: URLSearchParams, name: string): number {
    const value = searchParams.get(name);
    if (value === null || !/^(0|[1-9][0-9]*)$/.test(value)) {
        throw new InvalidArgumentError(`Document history ${name} must be a non-negative integer`);
    }

    const version = Number(value);
    if (!Number.isSafeInteger(version)) {
        throw new InvalidArgumentError(`Document history ${name} must be a non-negative integer`);
    }
    return version;
}
