import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess, getAccount} from "~/server/spaces/spaces_table.js";
import {
    TaskIndexDoc,
    TaskPositionByAccountIdAndNotepadPageId,
} from "~/server/tasks/data/task_index_doc.js";
import {authorizeTaskQueryAccess} from "~/server/tasks/data/task_table.js";
import {TaskRealtimeQuerySubscription} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId, TaskRealtimeQuerySubscriptionId} from "~/shared/id/types/id_types.js";
import {TaskSortableAccountModel} from "~/shared/tasks/model/task_sortable_account_model.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

export class TaskRealtimeConnection {
    private readonly _server: TaskRealtimeServer;
    private readonly _spaceId: SpaceId;

    private readonly _dangerouslyEscalateToSystemContext: <Value>(
        context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;

    private readonly _querySubscriptionById = new Map<
        TaskRealtimeQuerySubscriptionId,
        TaskRealtimeQuerySubscription
    >();

    constructor({
        server,
        spaceId,
        dangerouslyEscalateToSystemContext,
    }: {
        server: TaskRealtimeServer;
        spaceId: SpaceId;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
    }) {
        this._server = server;
        this._spaceId = spaceId;
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
    }

    public async authorize(context: ServerSessionActionContext) {
        await runAllPromises([
            // 1. Authorize that we still have access to the space:
            authorizeSpaceAccess(context, this._spaceId),

            // 2. Authorize that we still have access to each query subscription:
            runAllPromises(
                Array.from(this._querySubscriptionById.values(), querySubscription =>
                    authorizeTaskQueryAccess(context, {
                        filters: querySubscription.getFilters(),
                        sorts: querySubscription.getSorts(),
                    }),
                ),
            ),
        ]);
    }

    // Uses the arrow function syntax to avoid calling `this._send.bind(this)` when
    // calling `action.accept(this._send)`. It's important that we pass a function
    // to `action.accept()` that maintains the same reference to keep transaction
    // realtime events intact.
    private readonly _send = () => {};

    public readonly procedures: WebSocketConnectionProcedures<
        ServerSessionActionContextModules,
        typeof TaskRealtimeProtocol
    > = {
        subscribeToQuery: async (context, input) => {
            await authorizeTaskQueryAccess(context, input);

            // It's safe to escalate because we authorize the query is valid above.
            const {
                querySubscriptionId,
                hasMoreTasks,
                tasks,
                otherReferencedTasks,
                otherReferencedCollections,
            } = await this._dangerouslyEscalateToSystemContext(
                context,
                this._spaceId,
                async context => {
                    const querySubscription = await this._server.subscribeToQuery(context, {
                        spaceId: this._spaceId,
                        filters: input.filters,
                        sorts: input.sorts,
                        onAction: action => action.accept(this._send),
                    });

                    const querySubscriptionId = generateId<TaskRealtimeQuerySubscriptionId>();

                    assert(!this._querySubscriptionById.has(querySubscriptionId));
                    this._querySubscriptionById.set(querySubscriptionId, querySubscription);

                    const {hasMoreTasks, tasks, otherReferencedTasks, otherReferencedCollections} =
                        await querySubscription.loadMoreTasks(context, input.limit);

                    return {
                        querySubscriptionId,
                        hasMoreTasks,
                        tasks,
                        otherReferencedTasks,
                        otherReferencedCollections,
                    };
                },
            );

            return {
                querySubscriptionId,
            };
        },
        unsubscribeFromQuery: async (context, {querySubscriptionId}) => {
            const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
            if (!querySubscription) throw new NotFoundError("Query subscription not found");

            querySubscription.unsubscribe();

            return {};
        },
        loadMoreQueryTasks: (context, {querySubscriptionId, limit}) => {
            const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
            if (!querySubscription) throw new NotFoundError("Query subscription not found");

            // It's safe to escalate because in order to create a subscription we authorize
            // the query and we continually reauthorize the subscription through the
            // connection's `authorize()` method which is called every three minutes.
            return this._dangerouslyEscalateToSystemContext(
                context,
                this._spaceId,
                async context => {
                    await querySubscription.loadMoreTasks(context, limit);

                    return {};
                },
            );
        },
    };

    public handleClose() {
        for (const querySubscription of this._querySubscriptionById.values()) {
            querySubscription.unsubscribe();
        }
    }
}

async function createTaskModelFromIndexDoc(
    context: ServerSessionActionContext,
    task: TaskIndexDoc,
) {
    const [creatorAccount] = await runAllPromises([
        getAccount(context, task.spaceId, task.creator.accountId),
    ]);

    return {
        id: task.id,
        spaceId: task.spaceId,

        creator: new TaskSortableAccountModel({
            account: creatorAccount,
            workingAccountName: task.creator.workingAccountName,
        }),
        createdTime: task.createdTime,
        deletedTime: task.rawDeletedTime,
        undeletedTime: task.rawUndeletedTime,

        // NOCOMMIT: Show/hide this data based on whether the parent task is visible.
        // Just a `hasPrivateParent` field or something.
        // parent: {
        //     taskId: task.parent.taskId,
        //     position: task.parent.rawPosition,
        // },
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,

        // NOCOMMIT: Filter out collections and positions that are not visible to the
        // current user.
        // collections: {
        //     collections: task.collections.raw.positionById,
        //     positionById: task.collections.raw.positionById,
        // },

        notepadPages: {
            positionById: reduceIterable(
                filterIterable(task.notepadPages.raw.positionById.actualEntries(), ([key]) =>
                    key.startsWith(context.actor.getAccountId()),
                ),
                (positionById, [key, {value, version}]) =>
                    value !== null
                        ? positionById.apply({type: "Set", key, value, version})
                        : // It's important that we also add deleted values to the map so if an event is
                          // a position update is received out-of-order the delete wins.
                          positionById.apply({type: "Delete", key, version}),
                TaskPositionByAccountIdAndNotepadPageId.empty,
            ),
        },
    };
}
