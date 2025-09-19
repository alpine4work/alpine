import {apiTasksPaths} from "~/server/api/internal/tasks/api_tasks_paths.js";
import {createTestApiServer} from "~/server/api/internal/test_helpers/create_test_api_server.js";
import {
    testMessagingApiImplementation,
    testMessagingApiImplementationSearchInjection,
} from "~/server/api/internal/test_helpers/test_messaging_api_implementation.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";

const context = createTestContext({
    tasksInjection,
    searchInjection: testMessagingApiImplementationSearchInjection,
});

const server = createTestApiServer(context, apiTasksPaths);

testMessagingApiImplementation(context, server, {
    generateMissingRoomPath: () => `/tasks/${generateId<TaskId>()}`,
    createPrivateRoom: async session => {
        const task = await TestTask.create(session);
        return {roomPath: `/tasks/${task.id}`, room: task};
    },
});
