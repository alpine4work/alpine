import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {intoApiMessagePayload} from "~/server/api/internal/shared/into_api_message_payload.js";
import {getDocumentCommentPayload} from "~/server/documents/data/documents_actions.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";

export const apiDocumentsPaths: Pick<ApiPaths, keyof ApiPaths & `/documents/${string}`> = {
    "/documents/{id}/threads/{threadId}/messages/{index}": {
        get: async (context, {pathParams}) => {
            const message = await getDocumentCommentPayload(context, {
                documentId: pathParams.id,
                commentThreadId: pathParams.threadId,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/documents/${pathParams.id}/threads/${pathParams.threadId}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },
};
