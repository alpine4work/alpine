import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {ApiMessageResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";

export function mockApiGetTaskMessages(
    api: ApiClientMock,
    {
        spaceId,
        taskId,
        from,
        totalMessageCount,
        limit,
        cursor,
        createMessage,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        from?: "Start" | "End";
        totalMessageCount: number;
        limit: number;
        cursor?: number;
        createMessage: (index: number) => ApiMessageResponse;
    },
) {
    switch (from) {
        case undefined:
        case "Start": {
            let startIndex = (cursor ?? -1) + 1;
            startIndex = Math.max(startIndex, 0);

            let endIndex = startIndex + limit - 1;
            endIndex = Math.min(endIndex, totalMessageCount - 1);

            api.mockGet(
                "/tasks/{id}/messages",
                {
                    data: {
                        spaceId,
                        totalMessageCount,
                        nextCursor: endIndex !== totalMessageCount - 1 ? endIndex : null,
                        messages: createArrayWithLength(
                            Math.max(endIndex - startIndex + 1, 0),
                            index => createMessage(startIndex + index),
                        ),
                    },
                },
                {
                    path: {id: taskId},
                    query: {from, limit, cursor},
                },
            );
            break;
        }
        case "End": {
            let endIndex = (cursor ?? totalMessageCount) - 1;
            endIndex = Math.min(endIndex, totalMessageCount - 1);

            let startIndex = endIndex - limit + 1;
            startIndex = Math.max(startIndex, 0);

            api.mockGet(
                "/tasks/{id}/messages",
                {
                    data: {
                        spaceId,
                        totalMessageCount,
                        nextCursor: startIndex !== 0 ? startIndex : null,
                        messages: createArrayWithLength(
                            Math.max(endIndex - startIndex + 1, 0),
                            index => createMessage(startIndex + index),
                        ),
                    },
                },
                {
                    path: {id: taskId},
                    query: {from, limit, cursor},
                },
            );
            break;
        }
        default:
            throw exhaustive(from);
    }
}
