import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {intoApiMessagePayload} from "~/server/api/internal/shared/into_api_message_payload.js";
import {getPostCommentPayload} from "~/server/forum/data/forum_actions.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";

export const apiForumPaths: Pick<ApiPaths, keyof ApiPaths & `/posts/${string}`> = {
    "/posts/{id}/messages/{index}": {
        get: async (context, {pathParams}) => {
            const message = await getPostCommentPayload(context, {
                postId: pathParams.id,
                commentIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            return {
                content: {
                    roomPath: `/posts/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                },
            };
        },
    },
};
