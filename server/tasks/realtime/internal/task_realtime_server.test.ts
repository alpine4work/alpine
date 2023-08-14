import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {getAccountsTableForTest} from "~/server/dynamo/accounts_table.js";
// TODO(calebmer): We should move the test scenario helpers that needs this
// function near the `server/dynamo` directory.
// eslint-disable-next-line no-internal-imports
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {getSpacesTableForTest} from "~/server/dynamo/spaces_table.js";
import {
    afterCommitTaskActionTransactionEventEmitterForTest,
    backfillTaskActionTransactionHistoryTestCounter,
    commitTaskActionTransaction,
} from "~/server/dynamo/tasks_table.js";
import {
    TestContext,
    createTestContext,
} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/index/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {
    getTaskIndexDocIfExistsForTest,
    indexTaskActionTransactionTestCheckpoint,
    queryTaskIndex,
    queryTaskIndexTestCounter,
    refreshTaskIndexForTest,
} from "~/server/tasks/index/task_index.js";
import {TaskIndexDoc, TaskIndexDocWithVersion} from "~/server/tasks/index/task_index_doc.js";
import {taskRealtimeQueryStoreLoadTaskTestCheckpoint} from "~/server/tasks/realtime/internal/task_realtime_query_store.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/internal/task_realtime_server.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPriority} from "~/shared/tasks/task_priority.js";
import {TaskQueryEvaluationContext} from "~/shared/tasks/task_query_evaluation_context.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {
    TaskQueryNormalizedFilters,
    defaultTaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    defaultTaskQueryNormalizedSorts,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";

let testSpaceCount = 1;
let testAccountCount = 1;

const testScenarioClock = (() => {
    const clock = new HybridLogicalClock(unsynchronizedSystemClock);

    /**
     * Returns the current time. Never returns the same time and never returns a
     * decreasing time (aka this function is monotonic).
     *
     * Based on a `HybridLogicalClock` but returns a `Date` object.
     */
    function nowDate() {
        const [time, ticks] = clock.now();
        if (ticks === 0) return new Date(time);

        clock.tick([time + 1, 0]);
        return new Date(time + 1);
    }

    return Object.assign(clock, {nowDate});
})();

type TestScenarioSpaceCreateOptions = {
    name?: string;
};

// TODO(calebmer): I think this test scenario machinery should maybe become
// the main way we write tests in Cyberworlds? Deprecating
// `createTestSession()`.
//
// Some conventions:
// - Try to avoid properties that change on the scenario object
// - All common actions should be dot-accessible (e.g. `session.createTask()`
//   instead of `TestScenarioTask.create(session)`)
//
// Need to figure out how to do package splitting? Don't want all chat tests to
// depend on task code for example.
class TestScenarioSpace {
    public readonly context: TestContext;
    public readonly id: SpaceId;

    private constructor(context: TestContext, spaceId: SpaceId) {
        this.context = context;
        this.id = spaceId;
    }

    public static async create(context: TestContext, options?: TestScenarioSpaceCreateOptions) {
        const SpacesTable = getSpacesTableForTest();

        const id = generateId<SpaceId>();

        await SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: id,
            name: options?.name ?? `Test Space ${testSpaceCount++}`,
            createdTime: testScenarioClock.nowDate(),
        });

        return new TestScenarioSpace(context, id);
    }

    public systemAction() {
        return this.context.systemAction(this.id);
    }

    public async createSession(account?: TestScenarioAccount) {
        const AccountsTable = getAccountsTableForTest();
        const SpacesTable = getSpacesTableForTest();

        const transactionEntries = [];

        const accountId = account?.id ?? generateId<AccountId>();
        const sessionId = generateId<SessionId>();

        const createdTime = testScenarioClock.nowDate();

        if (!account) {
            const accountName = TestScenarioAccount.getNewName();

            transactionEntries.push(
                AccountsTable.transactionCreateItem({
                    partitionType: "Account",
                    sortRangeType: "Attributes",
                    accountId,
                    name: accountName,
                    createdTime,
                }),
            );

            account = TestScenarioAccount._newAssumingExists(context, accountId, accountName);
        }

        transactionEntries.push(
            AccountsTable.transactionCreateItem({
                partitionType: "Session",
                sortRangeType: "Attributes",
                sessionId,
                accountId,
                createdTime,
                initialIpAddress: null,
                initialUserAgent: null,
            }),
        );

        transactionEntries.push(
            SpacesTable.transactionCreateItem({
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: this.id,
                accountId,
                joinedTime: createdTime,
            }),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        return TestScenarioSpaceSession._newAssumingExists(this, account, sessionId, createdTime);
    }
}

type TestScenarioAccountCreateOptions = {
    name?: string;
};

class TestScenarioAccount {
    public readonly context: TestContext;
    public readonly id: AccountId;
    public readonly initialName: string;

    private constructor(context: TestContext, id: AccountId, initialName: string) {
        this.context = context;
        this.id = id;
        this.initialName = initialName;
    }

    public static _newAssumingExists(context: TestContext, id: AccountId, initialName: string) {
        return new TestScenarioAccount(context, id, initialName);
    }

    public static async create(context: TestContext, options?: TestScenarioAccountCreateOptions) {
        const AccountsTable = getAccountsTableForTest();

        const id = generateId<AccountId>();
        const name = options?.name ?? TestScenarioAccount.getNewName();

        await AccountsTable.createItem(context, {
            partitionType: "Account",
            sortRangeType: "Attributes",
            accountId: id,
            name,
            createdTime: testScenarioClock.nowDate(),
        });

        return new TestScenarioAccount(context, id, name);
    }

    public static getNewName() {
        return `Test Account ${testAccountCount++}`;
    }
}

class TestScenarioSpaceSession {
    public readonly context: TestContext;
    public readonly space: TestScenarioSpace;
    public readonly account: TestScenarioAccount;
    public readonly id: SessionId;
    public readonly createdTime: Date;

    private constructor(
        space: TestScenarioSpace,
        account: TestScenarioAccount,
        id: SessionId,
        createdTime: Date,
    ) {
        assert(space.context === account.context);

        this.context = space.context;
        this.space = space;
        this.account = account;
        this.id = id;
        this.createdTime = createdTime;
    }

    public static _newAssumingExists(
        space: TestScenarioSpace,
        account: TestScenarioAccount,
        id: SessionId,
        createdTime: Date,
    ) {
        return new TestScenarioSpaceSession(space, account, id, createdTime);
    }

    public static async create(space: TestScenarioSpace, account: TestScenarioAccount) {
        assert(space.context === account.context);

        const AccountsTable = getAccountsTableForTest();

        const id = generateId<SessionId>();
        const createdTime = testScenarioClock.nowDate();

        await AccountsTable.createItem(space.context, {
            partitionType: "Session",
            sortRangeType: "Attributes",
            sessionId: id,
            accountId: account.id,
            createdTime,
            initialIpAddress: null,
            initialUserAgent: null,
        });

        return new TestScenarioSpaceSession(space, account, id, createdTime);
    }

    public action() {
        return this.context.action(this);
    }

    public createTask() {
        return TestScenarioTask.create(this);
    }
}

class TestScenarioTask {
    public readonly context: TestContext;
    public readonly space: TestScenarioSpace;
    public readonly id: TaskId;

    private constructor(context: TestContext, space: TestScenarioSpace, id: TaskId) {
        this.context = context;
        this.space = space;
        this.id = id;
    }

    public static async create(session: TestScenarioSpaceSession) {
        const id = generateId<TaskId>();

        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time: testScenarioClock.now(),
                taskId: id,
                taskAction: {
                    type: "Create",
                    creator: TaskSortableAccount.test(session.account),
                    creatorTimeZone: defaultTimeZone,
                },
            },
        ]);

        return new TestScenarioTask(session.context, session.space, id);
    }

    public async getIndexDocWithVersion(): Promise<TaskIndexDocWithVersion> {
        // Wait for any indexing tasks before loading doc...
        await ProcessContextModule.waitForTestTasks();

        const task = await getTaskIndexDocIfExistsForTest(this.context, this.space.id, this.id);
        if (!task) throw new NotFoundError("Task not found");
        return task;
    }

    public async getIndexDoc(): Promise<TaskIndexDoc> {
        const {version, ...task} = await this.getIndexDocWithVersion();
        return task;
    }

    public async updateStatus(session: TestScenarioSpaceSession, statusType: TaskStatus["type"]) {
        const time = testScenarioClock.now();

        const status: TaskStatus =
            statusType === "Open"
                ? {type: "Open"}
                : {
                      type: "Closed",
                      closer: TaskSortableAccount.test(session),
                      closedTime: TaskFilterableTime.test(time),
                  };

        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time,
                taskId: this.id,
                taskAction: {
                    type: "UpdateStatus",
                    status,
                },
            },
        ]);
    }

    public async updatePriority(
        session: TestScenarioSpaceSession,
        priority: TaskPriority | null,
        {time}: {time?: HybridLogicalTime} = {},
    ) {
        await commitTaskActionTransaction(session.action(), session.space.id, [
            {
                type: "UpdateTask",
                time: time ?? testScenarioClock.now(),
                taskId: this.id,
                taskAction: {
                    type: "UpdatePriority",
                    priority,
                },
            },
        ]);
    }
}

const context = createTestContext({shouldStartOpensearch: true});

let afterEachCleanupCallbacks: Array<() => MaybePromise<void>> = [];

afterEach(async () => {
    const callbacks = afterEachCleanupCallbacks;
    afterEachCleanupCallbacks = [];

    await runAllPromises(callbacks.map(callback => callback()));
});

/**
 * Wait for OpenSearch to have indexed all our action transactions.
 */
async function waitForIndexActionTransactions(context: TestContext) {
    await ProcessContextModule.waitForTestTasks();
    await refreshTaskIndexForTest(context);
}

class TestScenarioTaskRealtimeServer {
    public readonly context: TestContext;
    private readonly _server: TaskRealtimeServer;
    private _applyActionTransactionPromises: Array<Promise<void>> = [];

    private _applyActionTransactionsPauseState:
        | {
              type: "Paused";
              actionTransactions: Array<{
                  spaceId: SpaceId;
                  committedTime: Date;
                  actions: ReadonlyArray<TaskAction>;
              }>;
          }
        | {
              type: "Unpaused";
          } = {
        type: "Unpaused",
    };

    constructor(context: TestContext) {
        const [server, {start, stop}] = TaskRealtimeServer.new();

        start(Promise.resolve());
        afterEachCleanupCallbacks.push(stop);

        const unsubscribe = assertExists(
            afterCommitTaskActionTransactionEventEmitterForTest,
        ).subscribe(({spaceId, committedTime, actions}) => {
            if (this._applyActionTransactionsPauseState.type === "Paused") {
                this._applyActionTransactionsPauseState.actionTransactions.push({
                    spaceId,
                    committedTime,
                    actions,
                });
            } else {
                this._applyActionTransactionPromises.push(
                    this._server.applyActionTransaction(context.systemAction(spaceId), {
                        spaceId,
                        committedTime,
                        actions,
                    }),
                );
            }
        });
        afterEachCleanupCallbacks.push(() => this.waitForApplyActionTransactions());
        afterEachCleanupCallbacks.push(unsubscribe);

        this.context = context;
        this._server = server;
    }

    public pauseApplyActionTransactions() {
        assert(this._applyActionTransactionsPauseState.type === "Unpaused");

        this._applyActionTransactionsPauseState = {type: "Paused", actionTransactions: []};
    }

    public unpauseApplyActionTransactions() {
        assert(this._applyActionTransactionsPauseState.type === "Paused");

        for (const {spaceId, committedTime, actions} of this._applyActionTransactionsPauseState
            .actionTransactions) {
            this._applyActionTransactionPromises.push(
                this._server.applyActionTransaction(context.systemAction(spaceId), {
                    spaceId,
                    committedTime,
                    actions,
                }),
            );
        }

        this._applyActionTransactionsPauseState = {type: "Unpaused"};
    }

    /**
     * Wait for all `applyActionTransaction()` calls made against our server.
     */
    public async waitForApplyActionTransactions() {
        const promises = this._applyActionTransactionPromises;
        this._applyActionTransactionPromises = [];

        await runAllPromises(promises);
    }

    /**
     * Wait until all parallel processing tasks have settled to make sure
     * `loadQuery()` doesn't see stale data.
     */
    public async wait() {
        await runAllPromises([
            waitForIndexActionTransactions(this.context),
            this.waitForApplyActionTransactions(),
        ]);
    }

    public async loadQuery(
        session: TestScenarioSpaceSession,
        options?: {
            filters?: ReadonlyArray<TaskQueryFilter> | TaskQueryNormalizedFilters;
            sorts?: ReadonlyArray<TaskQuerySort> | ReadonlyArray<TaskQueryNormalizedSort>;
            limit?: number;
        },
    ): Promise<{
        tasks: Array<TaskIndexDoc>;
        hasMoreTasks: boolean;
    }> {
        const evaluationContext: TaskQueryEvaluationContext = {
            currentAccountId: session.account.id,
            currentDate: toCalendarDate(
                parseAbsolute(testScenarioClock.nowDate().toISOString(), defaultTimeZone),
            ),
        };

        const filters = options?.filters
            ? isReadonlyArray(options.filters)
                ? normalizeTaskQueryFilters(options.filters, evaluationContext)
                : ({type: "Possible", normalizedFilters: options.filters} as const)
            : normalizeTaskQueryFilters([], evaluationContext);

        if (filters.type === "Impossible") return {tasks: [], hasMoreTasks: false};

        return this._server.loadQuery(session.space.systemAction(), {
            spaceId: session.space.id,
            filters: filters.normalizedFilters,
            sorts: normalizeTaskQuerySorts(options?.sorts ?? []),
            limit: options?.limit ?? 100,
        });
    }
}

function testQueryTaskIndex(
    space: TestScenarioSpace,
    {
        filters = defaultTaskQueryNormalizedFilters,
        sorts = defaultTaskQueryNormalizedSorts,
        limit = 100,
        afterCursor = null,
    }: {
        filters?: TaskQueryNormalizedFilters;
        sorts?: ReadonlyArray<TaskQueryNormalizedSort>;
        limit?: number;
        afterCursor?: TaskIndexDoc | null;
    } = {},
) {
    return queryTaskIndex(space.systemAction(), {
        spaceId: space.id,
        filters,
        sorts,
        limit,
        afterCursor: afterCursor
            ? getTaskQueryNormalizedSortCursorFromIndexDoc(sorts, afterCursor)
            : null,
    });
}

test("loads an empty query when no tasks are in the space", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });
});

test("loads a query with one task", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    const task = await session.createTask();
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [await task.getIndexDoc()],
    });
});

test("loads a query with three tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("reuses a loaded query with three tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 1})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("can query multiple spaces", async () => {
    const space1 = await TestScenarioSpace.create(context);
    const space2 = await TestScenarioSpace.create(context);
    const {getCount: getCount1} = queryTaskIndexTestCounter.recordForTest(space1.id);
    const {getCount: getCount2} = queryTaskIndexTestCounter.recordForTest(space2.id);
    const session1 = await space1.createSession();
    const session2 = await space2.createSession();

    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        session1.createTask(),
        session1.createTask(),
        session1.createTask(),
        session2.createTask(),
        session2.createTask(),
        session2.createTask(),
    ]);

    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount1()).toEqual(0);
    expect(getCount2()).toEqual(0);

    expect(await server.loadQuery(session1, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount1()).toEqual(1);
    expect(getCount2()).toEqual(0);

    expect(await server.loadQuery(session2, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount1()).toEqual(1);
    expect(getCount2()).toEqual(1);

    expect(await server.loadQuery(session1, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(await server.loadQuery(session2, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount1()).toEqual(1);
    expect(getCount2()).toEqual(1);
});

test("reuses a loaded query with slightly different but equivalent filters", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);
    const [task1, task2, task3] = await runAllPromises([
        session1.createTask(),
        session2.createTask(),
        session1.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session1.account.id},
                            {type: "Account", accountId: session2.account.id},
                        ],
                    },
                },
            ],
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(
        await server.loadQuery(session1, {
            filters: [
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [
                            {type: "Account", accountId: session2.account.id},
                            {type: "Account", accountId: session1.account.id},
                        ],
                    },
                },
            ],
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("loads up to the limit even when reusing a query", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 10})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("has more tasks is true when loading a subset of a reused query", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("will load with a limit of zero", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: true,
        tasks: [],
    });

    expect(getCount()).toEqual(2);
});

test("will load with a limit of zero when there are no tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 0})).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    expect(getCount()).toEqual(1);
});

test("won't load with a negative limit", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    await runAllPromises([session.createTask(), session.createTask(), session.createTask()]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    await expect(server.loadQuery(session, {limit: -1})).rejects.toThrow();
});

test("won't load with a non-integer limit", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    await runAllPromises([session.createTask(), session.createTask(), session.createTask()]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    await expect(server.loadQuery(session, {limit: 2.17})).rejects.toThrow();
});

test("will dedupe parallel loads (scenario 1)", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await runAllPromises([
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 5}),
            server.loadQuery(session, {limit: 3}),
        ]),
    ).toEqual([
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
                task4.getIndexDoc(),
                task5.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
    ]);

    expect(getCount()).toEqual(2);
});

test("will dedupe parallel loads (scenario 2)", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();
    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);
    const server = new TestScenarioTaskRealtimeServer(context);

    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await runAllPromises([
            server.loadQuery(session, {limit: 5}),
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 3}),
            server.loadQuery(session, {limit: 3}),
        ]),
    ).toEqual([
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
                task4.getIndexDoc(),
                task5.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
        {
            hasMoreTasks: true,
            tasks: await runAllPromises([
                task1.getIndexDoc(),
                task2.getIndexDoc(),
                task3.getIndexDoc(),
            ]),
        },
    ]);

    expect(getCount()).toEqual(1);
});

test("will backfill action history to load a query", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    const {getCount} = backfillTaskActionTransactionHistoryTestCounter.recordForTest(space.id);

    const [task1, task2] = await runAllPromises([session.createTask(), session.createTask()]);

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task3, task4] = await runAllPromises([session.createTask(), session.createTask()]);

    await server.waitForApplyActionTransactions();

    expect(await testQueryTaskIndex(space)).toEqual([]);

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("will backfill action history to load a query and catch up a query with partial results", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();
    const {getCount} = backfillTaskActionTransactionHistoryTestCounter.recordForTest(space.id);

    const [task1, task2] = await runAllPromises([session.createTask(), session.createTask()]);
    await waitForIndexActionTransactions(context);
    const [task3, task4] = await runAllPromises([session.createTask(), session.createTask()]);

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task5, task6] = await runAllPromises([session.createTask(), session.createTask()]);

    await server.waitForApplyActionTransactions();

    expect(await testQueryTaskIndex(space)).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    );

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 5})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 6})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);
});

test("can load an empty task array when there are still more visible tasks in the query", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    const server = new TestScenarioTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    expect(await testQueryTaskIndex(space)).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(getCount()).toEqual(2);

    await task3.updateStatus(session, "Closed");
    await waitForIndexActionTransactions(context);

    expect(getCount()).toEqual(2);

    const [task4, task5] = await runAllPromises([session.createTask(), session.createTask()]);
    await server.waitForApplyActionTransactions();

    expect(getCount()).toEqual(2);

    expect(await testQueryTaskIndex(space)).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    );

    expect(getCount()).toEqual(3);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(4);
});

test("may not return enough tasks to meet the limit when index is behind", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    const server = new TestScenarioTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(await server.loadQuery(session, {limit: 2})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(1);

    await task3.updateStatus(session, "Closed");
    await task4.updateStatus(session, "Closed");
    await server.waitForApplyActionTransactions();

    expect(getCount()).toEqual(1);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    expect(getCount()).toEqual(2);

    await server.wait();

    expect(getCount()).toEqual(2);

    expect(await server.loadQuery(session, {limit: 4})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("pagination cursor is maintained even if the underlying item moves", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await task6.updatePriority(session, "High");
    await task7.updatePriority(session, "Urgent");
    await task8.updatePriority(session, "Urgent");

    const server = new TestScenarioTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
            limit: 4,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    const oldTask6IndexDoc = await task6.getIndexDoc();

    await task6.updatePriority(session, "Low");
    await server.waitForApplyActionTransactions();

    expect(getCount()).toEqual(1);

    expect(
        await testQueryTaskIndex(space, {
            sorts: normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]),
        }),
    ).toEqual(
        await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            oldTask6IndexDoc,
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    );

    expect(getCount()).toEqual(2);

    expect(await task6.getIndexDoc()).not.toEqual(oldTask6IndexDoc);

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("pagination cursor is maintained even if the underlying item moves and index updates", async () => {
    const space = await TestScenarioSpace.create(context);
    const {getCount} = queryTaskIndexTestCounter.recordForTest(space.id);
    const session = await space.createSession();

    const [task1, task2, task3, task4, task5, task6, task7, task8] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await task6.updatePriority(session, "High");
    await task7.updatePriority(session, "Urgent");
    await task8.updatePriority(session, "Urgent");

    const server = new TestScenarioTaskRealtimeServer(context);
    await server.wait();

    expect(getCount()).toEqual(0);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
            limit: 4,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(1);

    const oldTask6IndexDoc = await task6.getIndexDoc();

    await task6.updatePriority(session, "Low");
    await server.wait();

    expect(getCount()).toEqual(1);

    expect(
        await testQueryTaskIndex(space, {
            sorts: normalizeTaskQuerySorts([{type: "Priority", direction: "Descending"}]),
        }),
    ).toEqual(
        await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    );

    expect(getCount()).toEqual(2);

    expect(await task6.getIndexDoc()).not.toEqual(oldTask6IndexDoc);

    expect(getCount()).toEqual(2);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Descending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task7.getIndexDoc(),
            task8.getIndexDoc(),
            task5.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task6.getIndexDoc(),
        ]),
    });

    expect(getCount()).toEqual(3);
});

test("can load while server receiving action transactions is delayed (scenario 1)", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);
    server.pauseApplyActionTransactions();

    // Ensure action history without caching our test query...
    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {type: "OneOf", displayStatuses: new Set(["Closed"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    const [task1, task2] = await runAllPromises([session.createTask(), session.createTask()]);

    await waitForIndexActionTransactions(context);

    const [task3] = await runAllPromises([session.createTask()]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    await waitForIndexActionTransactions(context);

    const [task4] = await runAllPromises([session.createTask()]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc()]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });
});

test("can load while server receiving action transactions is delayed (scenario 2)", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);
    server.pauseApplyActionTransactions();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    const [task1, task2] = await runAllPromises([session.createTask(), session.createTask()]);

    await waitForIndexActionTransactions(context);

    const [task3] = await runAllPromises([session.createTask()]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    await waitForIndexActionTransactions(context);

    const [task4] = await runAllPromises([session.createTask()]);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: [],
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });
});

test("load can introduce new task data which moves task outside of loaded range", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "High");
    await waitForIndexActionTransactions(context);

    expect(oldTask2IndexDoc).not.toEqual(await task2.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task2.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });
});

test("load can introduce new task data which keeps task inside loaded range", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Low");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask1IndexDoc = await task1.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await waitForIndexActionTransactions(context);

    expect(oldTask1IndexDoc).not.toEqual(await task1.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task1.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task1.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("load can introduce new task data which removes task from query", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Low");
    await waitForIndexActionTransactions(context);

    expect(oldTask2IndexDoc).not.toEqual(await task1.getIndexDoc());

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("load can introduce new task data which adds updated task to query", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [{type: "Priority", operation: {type: "OneOf", priorities: new Set(["Low"])}}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task2.getIndexDoc()]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await task2.updatePriority(session, "Medium");
    await waitForIndexActionTransactions(context);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("load can introduce new task data which adds fresh task to query", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Low");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "Medium");

    await server.wait();
    server.pauseApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await task2.updatePriority(session, "Medium");
    await waitForIndexActionTransactions(context);

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    server.unpauseApplyActionTransactions();
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("if loaded task is older than store task then query will return store task (scenario 1)", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Low");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]));
});

test("if loaded task is older than store task then query will return store task (scenario 2)", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.wait();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Low");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: true,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc(), oldTask2IndexDoc, task3.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "Low"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: true,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );
});

test("if loaded task is older than store task then query will return store task (scenario 3)", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "High");
    await task3.updatePriority(session, "Medium");
    await task4.updatePriority(session, "Medium");
    await task5.updatePriority(session, "High");
    await server.wait();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    const oldTask2IndexDoc = await task2.getIndexDoc();

    await task2.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await testQueryTaskIndex(space, {
            limit: 5,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            oldTask2IndexDoc,
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 5,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 5,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to catch stale data up", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await server.wait();

    const oldTask1IndexDoc = await task1.getIndexDoc();
    const oldTask3IndexDoc = await task3.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await task3.updatePriority(session, "High");
    await server.waitForApplyActionTransactions();

    expect(await task1.getIndexDoc()).not.toEqual(oldTask1IndexDoc);
    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(await testQueryTaskIndex(space, {limit: 3})).toEqual(
        await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), oldTask3IndexDoc]),
    );

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(await testQueryTaskIndex(space, {limit: 3})).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions that hide tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await server.wait();

    const oldTask1IndexDoc = await task1.getIndexDoc();
    const oldTask3IndexDoc = await task3.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Urgent");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(await task1.getIndexDoc()).not.toEqual(oldTask1IndexDoc);
    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: true,
                    ifLow: true,
                    ifMedium: false,
                    ifHigh: true,
                    ifUrgent: true,
                },
            },
        }),
    ).toEqual(await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), oldTask3IndexDoc]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([task2.getIndexDoc()]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: true,
                    ifLow: true,
                    ifMedium: false,
                    ifHigh: true,
                    ifUrgent: true,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task2.getIndexDoc(), task4.getIndexDoc(), task5.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions that move tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await server.wait();

    const oldTask1IndexDoc = await task1.getIndexDoc();
    const oldTask3IndexDoc = await task3.getIndexDoc();

    await task1.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Urgent");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(await task1.getIndexDoc()).not.toEqual(oldTask1IndexDoc);
    expect(await task3.getIndexDoc()).not.toEqual(oldTask3IndexDoc);

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(await runAllPromises([oldTask1IndexDoc, task2.getIndexDoc(), oldTask3IndexDoc]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc(), task2.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: true,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    expect(
        await testQueryTaskIndex(space, {
            sorts: [
                {type: "Priority", direction: "Ascending", missing: "Last"},
                {type: "CreatedTime", direction: "Ascending", missing: "Last"},
            ],
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks that have already been loaded", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    expect(await server.loadQuery(session, {limit: 3})).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc()]));

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions but won't add false positive missing tasks", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task2.updateStatus(session, "Closed");
    await task3.updatePriority(session, "Medium");
    await task4.updateStatus(session, "Closed");
    await task5.updatePriority(session, "Medium");

    await server.wait();

    await task2.updateStatus(session, "Open");
    await task4.updateStatus(session, "Open");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc(), task5.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions but won't add false positive missing tasks that were already loaded", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3, task4, task5] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");
    await task2.updatePriority(session, "Medium");
    await task2.updateStatus(session, "Closed");
    await task3.updatePriority(session, "Medium");
    await task4.updateStatus(session, "Closed");
    await task5.updatePriority(session, "Medium");

    expect(
        await server.loadQuery(session, {
            filters: [
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                    },
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task4.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await server.wait();

    await task2.updateStatus(session, "Open");
    await task4.updateStatus(session, "Open");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc(), task5.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: false,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    );

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
            task5.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks and works if before we can add task it is added by other means", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(await runAllPromises([task1.getIndexDoc()]));

    const pausePromise = taskRealtimeQueryStoreLoadTaskTestCheckpoint.pauseForTest(space.id);

    const loadPromise = server.loadQuery(session, {
        limit: 3,
        filters: [
            {type: "Priority", operation: {type: "OneOf", priorities: new Set(["Medium", "High"])}},
        ],
    });

    const {unpause} = await pausePromise;

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await task3.updatePriority(session, "High");
    await server.waitForApplyActionTransactions();

    unpause();

    expect(await loadPromise).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("after loading tasks we will replay actions to add missing tasks if the task is stale we catch it up", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "Medium");

    await server.wait();

    await task2.updatePriority(session, "Medium");
    await task3.updatePriority(session, "Medium");
    await server.waitForApplyActionTransactions();

    const pausePromise = indexTaskActionTransactionTestCheckpoint.pauseForTest(space.id);
    const updatedTime = testScenarioClock.now();
    const updatePromise = task2.updatePriority(session, "High", {time: updatedTime});
    const {unpause} = await pausePromise;
    await server.waitForApplyActionTransactions();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([
            getTaskIndexDocIfExistsForTest(context, space.id, task1.id).then(task =>
                omitObject(assertExists(task), ["version"]),
            ),
        ]),
    );

    expect(
        await getTaskIndexDocIfExistsForTest(context, space.id, task2.id).then(task =>
            omitObject(assertExists(task), ["version"]),
        ),
    ).not.toEqual(
        await getTaskIndexDocIfExistsForTest(context, space.id, task2.id)
            .then(task => omitObject(assertExists(task), ["version"]))
            .then(task => ({
                ...task,
                priority: task.priority.apply({value: "High", version: updatedTime}),
            })),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            getTaskIndexDocIfExistsForTest(context, space.id, task1.id).then(task =>
                omitObject(assertExists(task), ["version"]),
            ),
            getTaskIndexDocIfExistsForTest(context, space.id, task2.id)
                .then(task => omitObject(assertExists(task), ["version"]))
                .then(task => ({
                    ...task,
                    priority: task.priority.apply({value: "High", version: updatedTime}),
                })),
            getTaskIndexDocIfExistsForTest(context, space.id, task3.id).then(task =>
                omitObject(assertExists(task), ["version"]),
            ),
        ]),
    });

    unpause();
    await updatePromise;

    await server.wait();

    expect(
        await testQueryTaskIndex(space, {
            limit: 3,
            filters: {
                ...defaultTaskQueryNormalizedFilters,
                priorityFilter: {
                    ifNull: false,
                    ifLow: false,
                    ifMedium: true,
                    ifHigh: true,
                    ifUrgent: false,
                },
            },
        }),
    ).toEqual(
        await runAllPromises([task1.getIndexDoc(), task2.getIndexDoc(), task3.getIndexDoc()]),
    );

    expect(
        await server.loadQuery(session, {
            limit: 3,
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: new Set(["Medium", "High"])},
                },
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const updatedTime = testScenarioClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            expectedTask2IndexDoc,
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change and is hidden", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    const updatedTime = testScenarioClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "NoneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });
});

test("task updates in query after change and is shown", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "High");
    await task3.updatePriority(session, "High");
    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });

    const updatedTime = testScenarioClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            expectedTask2IndexDoc,
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change and is shown when task is loaded", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "High");
    await task3.updatePriority(session, "High");
    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(await server.loadQuery(session)).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task2.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([task1.getIndexDoc(), task3.getIndexDoc()]),
    });

    const updatedTime = testScenarioClock.now();
    await task2.updatePriority(session, "High", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "High", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            filters: [
                {type: "Priority", operation: {type: "OneOf", priorities: new Set(["High"])}},
            ],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            expectedTask2IndexDoc,
            task3.getIndexDoc(),
        ]),
    });
});

test("task updates in query after change and is moved", async () => {
    const space = await TestScenarioSpace.create(context);
    const session = await space.createSession();

    const server = new TestScenarioTaskRealtimeServer(context);

    const [task1, task2, task3] = await runAllPromises([
        session.createTask(),
        session.createTask(),
        session.createTask(),
    ]);

    await task1.updatePriority(session, "High");
    await task3.updatePriority(session, "High");
    await server.wait();
    const oldTask2IndexDoc = await task2.getIndexDoc();

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            task1.getIndexDoc(),
            task3.getIndexDoc(),
            task2.getIndexDoc(),
        ]),
    });

    const updatedTime = testScenarioClock.now();
    await task2.updatePriority(session, "Low", {time: updatedTime});

    await server.wait();

    const expectedTask2IndexDoc = {
        ...oldTask2IndexDoc,
        priority: oldTask2IndexDoc.priority.apply({value: "Low", version: updatedTime}),
    };

    expect(await task2.getIndexDoc()).toEqual(expectedTask2IndexDoc);

    expect(
        await server.loadQuery(session, {
            sorts: [{type: "Priority", direction: "Ascending"}],
        }),
    ).toEqual({
        hasMoreTasks: false,
        tasks: await runAllPromises([
            expectedTask2IndexDoc,
            task1.getIndexDoc(),
            task3.getIndexDoc(),
        ]),
    });
});
