import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {intoApiMessagePayload} from "~/server/api/internal/shared/into_api_message_payload.js";
import {getTaskCommentPayload} from "~/server/tasks/data/task_table.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";

export const apiTasksPaths: Pick<ApiPaths, keyof ApiPaths & `/tasks/${string}`> = {
    "/tasks/{id}/messages/{index}": {
        get: async (context, {pathParams}) => {
            const message = await getTaskCommentPayload(context, {
                taskId: pathParams.id,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/tasks/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },
};
