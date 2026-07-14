import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {
    ApiTaskMockOptions,
    createApiTaskMock,
} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export function mockApiGetTaskWithoutNotes(
    api: ApiClientMock,
    {
        spaceId,
        ...options
    }: {
        spaceId: SpaceId;
    } & Omit<ApiTaskMockOptions, "notes">,
) {
    const task = createApiTaskMock(options);

    api.mockGet("/tasks/{id}-without-notes", {
        params: {
            path: {id: task.id},
        },
        data: {
            spaceId,
            task: omitObject(task, ["notes"]),
        },
    });

    return {task};
}
