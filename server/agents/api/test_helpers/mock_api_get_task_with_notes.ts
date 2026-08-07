import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {
    ApiTaskMockOptions,
    createApiTaskMock,
} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function mockApiGetTaskWithNotes(
    api: ApiClientMock,
    {
        spaceId,
        ...options
    }: {
        spaceId: SpaceId;
    } & ApiTaskMockOptions,
) {
    const task = createApiTaskMock(options);

    api.mockGet("/tasks/{id}-with-notes", {
        params: {
            path: {id: task.id},
        },
        data: {
            spaceId,
            task,
        },
    });

    return {task};
}
