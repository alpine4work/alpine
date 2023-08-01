import {addDays} from "date-fns";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {createTestOpensearch} from "~/server/opensearch/test_helpers/create_test_opensearch.js";
import {indexTaskSpaceActionTransactionWithoutCommitForTest} from "~/server/tasks/index/index_task_space_action_transaction.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

const opensearch = createTestOpensearch();

const opensearchClient = new Lazy(() => {
    return new OpensearchClient({
        protocol: "http",
        host: `localhost:${opensearch.getPort()}`,
    });
});

const context = createTestContext();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);
const session3 = createTestSession(context, space);
const otherSpace = createTestSpace(context);
const otherSession = createTestSession(context, otherSpace);

const taskAccount1 = new TaskSortableAccount({
    accountId: session1.accountId,
    workingAccountName: session1.account.name,
});

let lastTime = Date.now();

// Make sure this function returns a monotonically increasing date to
// avoid flaky errors.
function getCurrentTime() {
    const currentTime = Math.max(Date.now(), lastTime + 1);
    lastTime = currentTime;
    return new Date(currentTime);
}

function getCurrentTaskTime() {
    return new TaskFilterableTime({
        absoluteTime: getCurrentTime(),
        setterTimeZone: defaultTimeZone,
    });
}

function getUnreasonableTime() {
    return addDays(getCurrentTime(), 7);
}

function getUnreasonableTaskTime() {
    return new TaskFilterableTime({
        absoluteTime: getUnreasonableTime(),
        setterTimeZone: defaultTimeZone,
    });
}

test("asdf", async () => {
    await indexTaskSpaceActionTransactionWithoutCommitForTest(
        context.systemAction(space.id),
        opensearchClient.get(),
        space.id,
        [
            {
                type: "UpdateTask",
                taskId: generateId(),
                taskAction: {
                    type: "Create",
                    creator: taskAccount1,
                    createdTime: getCurrentTaskTime(),
                },
            },
        ],
    );
});
