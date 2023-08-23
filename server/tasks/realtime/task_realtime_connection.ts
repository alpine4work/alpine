import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {authorizeSpaceAccess, getAccount} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    isTaskCollectionIndexDocAccessAuthorized,
    isTaskIndexDocAccessAuthorized,
} from "~/server/tasks/data/task_table.js";
import {
    TaskRealtimeQuerySubscription,
    TaskRealtimeQuerySubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_query_subscription.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {
    TaskRealtimeUpdateEventBuilder,
    TaskRealtimeUpdateEventSender,
} from "~/server/tasks/realtime/task_realtime_update_event.js";
import {WebSocketConnectionProcedures} from "~/server/web_socket/web_socket_server.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    SpaceId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeQuerySubscriptionId,
} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionModel} from "~/shared/tasks/task_collection_model.js";
import {TaskModel, TaskModelData} from "~/shared/tasks/task_model.js";
import {TaskPositionByAccountIdAndNotepadPageIdMap} from "~/shared/tasks/task_position_by_account_id_and_notepad_page_id.js";
import {TaskRealtimeEvent, TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";

export class TaskRealtimeConnection {
    private readonly _server: TaskRealtimeServer;
    private readonly _spaceId: SpaceId;
    private readonly _accountId: AccountId;

    private readonly _dangerouslyEscalateToSystemContext: <Value>(
        context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;
    private readonly _sendEvent: (context: ServerProcessContext, event: TaskRealtimeEvent) => void;

    private readonly _querySubscriptionById = new Map<
        TaskRealtimeQuerySubscriptionId,
        {
            querySubscription: TaskRealtimeQuerySubscription;
            onAuthorize: (
                context: TaskRealtimeSystemActionContext,
                eventBuilder: TaskRealtimeUpdateEventBuilder,
            ) => Promise<void>;
        }
    >();

    constructor({
        server,
        spaceId,
        accountId,
        dangerouslyEscalateToSystemContext,
        sendEvent,
    }: {
        server: TaskRealtimeServer;
        spaceId: SpaceId;
        accountId: AccountId;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        sendEvent: (context: ServerProcessContext, event: TaskRealtimeEvent) => void;
    }) {
        this._server = server;
        this._spaceId = spaceId;
        this._accountId = accountId;
        this._dangerouslyEscalateToSystemContext = dangerouslyEscalateToSystemContext;
        this._sendEvent = sendEvent;
    }

    public handleClose() {
        for (const {querySubscription} of this._querySubscriptionById.values()) {
            querySubscription.unsubscribe();
        }
    }

    public async authorize(context: ServerSessionActionContext) {
        const eventBuilder = new TaskRealtimeUpdateEventBuilder();

        await runAllPromises([
            // 1. Authorize that we still have access to the space:
            authorizeSpaceAccess(context, this._spaceId),

            // 2. Authorize that we still have access to each query subscription:
            runAllPromises(
                Array.from(
                    this._querySubscriptionById.values(),
                    async ({querySubscription, onAuthorize}) => {
                        await this._server.authorizeQueryAccess(context, {
                            spaceId: this._spaceId,
                            filters: querySubscription.getFilters(),
                            sorts: querySubscription.getSorts(),
                        });

                        // 3. Reauthorize the tasks within a query subscription:
                        await this._dangerouslyEscalateToSystemContext(
                            context,
                            this._spaceId,
                            context => onAuthorize(context, eventBuilder),
                        );
                    },
                ),
            ),
        ]);

        // 4. If authorization changed for any referenced tasks we'll have a realtime
        // event to send.
        await eventBuilder.send(context);
    }

    public readonly procedures: WebSocketConnectionProcedures<
        ServerSessionActionContextModules,
        typeof TaskRealtimeProtocol
    > = {
        subscribeToQuery: async (context, input) => {
            await this._server.authorizeQueryAccess(context, {
                spaceId: this._spaceId,
                filters: input.filters,
                sorts: input.sorts,
            });

            // It's safe to escalate because we authorize the query is valid above.
            return this._dangerouslyEscalateToSystemContext(
                context,
                this._spaceId,
                async context => {
                    const {onAuthorize, ...callbacks} = this._createQuerySubscriptionCallbacks();

                    const querySubscription = await this._server.subscribeToQuery(context, {
                        spaceId: this._spaceId,
                        filters: input.filters,
                        sorts: input.sorts,
                        callbacks,
                    });

                    const querySubscriptionId = generateId<TaskRealtimeQuerySubscriptionId>();

                    assert(!this._querySubscriptionById.has(querySubscriptionId));
                    this._querySubscriptionById.set(querySubscriptionId, {
                        querySubscription,
                        onAuthorize,
                    });

                    try {
                        const eventBuilder = new TaskRealtimeUpdateEventBuilder();

                        await querySubscription.loadMoreTasks(context, eventBuilder, input.limit);

                        await eventBuilder.send(context);
                        return {querySubscriptionId};
                    } catch (error) {
                        // If there's an error, unsubscribe so we don't have a dangling subscription.
                        this._querySubscriptionById.delete(querySubscriptionId);
                        querySubscription.unsubscribe();

                        throw error;
                    }
                },
            );
        },
        unsubscribeFromQuery: async (context, {querySubscriptionId}) => {
            const querySubscription = this._querySubscriptionById.get(querySubscriptionId);
            if (!querySubscription) throw new NotFoundError("Query subscription not found");

            this._querySubscriptionById.delete(querySubscriptionId);
            querySubscription.querySubscription.unsubscribe();

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
                    const eventBuilder = new TaskRealtimeUpdateEventBuilder();

                    await querySubscription.querySubscription.loadMoreTasks(
                        context,
                        eventBuilder,
                        limit,
                    );

                    await eventBuilder.send(context);
                    return {};
                },
            );
        },
    };

    public readonly _sender: TaskRealtimeUpdateEventSender = {
        // Before we actually send an update event to the client we need to clean up
        // our actions and tasks, removing any last private data. We also need to load
        // the `AccountModel`s for any referenced accounts so we can render them on the
        // client.
        //
        // Finally, once all that is done we can send the event to the client!
        send: async (context, event) => {
            const actions = filterMapArray(event.actions, action =>
                prepareTaskActionForClient(this._accountId, action),
            );

            const backfillAuthorizedTasks = event.backfillAuthorizedTasks.map(task =>
                prepareTaskForClient(this._accountId, task),
            );
            const backfillUnauthorizedTaskIds = event.backfillUnauthorizedTaskIds;

            const backfillAuthorizedCollections = event.backfillAuthorizedCollections.map(
                collection => prepareTaskCollectionForClient(collection),
            );
            const backfillUnauthorizedCollectionIds = event.backfillUnauthorizedCollectionIds;

            const accountIds = new Set<AccountId>();

            for (const task of backfillAuthorizedTasks) {
                collectReferencedAccountIdsFromTaskModelData(accountIds, task.rawData);
            }

            for (const action of actions) {
                collectReferencedAccountIdsFromTaskAction(accountIds, action);
            }

            const referencedAccounts = await runAllPromises(
                Array.from(accountIds, accountId => getAccount(context, this._spaceId, accountId)),
            );

            this._sendEvent(context, {
                type: "Update",
                actions,
                backfillAuthorizedTasks,
                backfillUnauthorizedTaskIds,
                backfillAuthorizedCollections,
                backfillUnauthorizedCollectionIds,
                referencedAccounts,
            });
        },
    };

    /**
     * Our query subscription callbacks are responsible for actually adding actions
     * to an event builder and managing authorization checking for referenced
     * tasks/collections.
     *
     * A connection may have multiple query subscriptions. Each subscription
     * maintains its own authorization state for simplicity. However, if an action
     * affects multiple subscriptions then we still only send one event to the
     * client.
     *
     * The tradeoff for simplicity is a little waste in event payload size. Since
     * two subscriptions may separately backfill a task. We find this to be
     * acceptable.
     *
     * Sharing state between query subscriptions shouldn't be too hard to implement
     * if we ever find it useful.
     */
    private _createQuerySubscriptionCallbacks(): TaskRealtimeQuerySubscriptionCallbacks & {
        onAuthorize: (
            context: TaskRealtimeSystemActionContext,
            eventBuilder: TaskRealtimeUpdateEventBuilder,
        ) => Promise<void>;
    } {
        const referencedTaskById = new Map<
            TaskId,
            {task: TaskIndexDoc; isAccessAuthorizedPromise: Promise<boolean>}
        >();

        const referencedCollectionById = new Map<
            TaskCollectionId,
            {collection: TaskCollectionIndexDoc; isAccessAuthorizedPromise: Promise<boolean>}
        >();

        return {
            onLoadedTaskAdd: (context, eventBuilder, newTask) => {
                // Clients don't have the latest task so backfill the entire task object.
                // Since the query is authorized, all loaded tasks are also authorized.
                eventBuilder.addAuthorizedTaskBackfill(this._sender, newTask);
            },
            onLoadedTaskUpdate: (context, eventBuilder, taskId, oldTask, newTask, actions) => {
                // Since the query is authorized, all loaded tasks are also authorized.
                // Clients should see all actions on loaded tasks.
                eventBuilder.addActions(this._sender, actions);
            },
            onLoadedTaskRemove: (context, eventBuilder, oldTask, actions) => {
                // Since the query is authorized, all loaded tasks are also authorized.
                // Clients should see all actions that remove a task from a query. That way the
                // client can apply the actions locally and remove the task from its own local
                // query representation.
                eventBuilder.addActions(this._sender, actions);
            },
            onReferencedTaskAdd: (context, eventBuilder, newTask) => {
                const referencedTask = referencedTaskById.get(newTask.id);
                assert(!referencedTask);

                const isAccessAuthorizedPromise = isTaskIndexDocAccessAuthorized(
                    context,
                    this._accountId,
                    newTask,
                    "View",
                    {
                        getTaskIndexDoc: taskId =>
                            this._server.getTask(context, this._spaceId, taskId),
                        getCollectionIndexDoc: collectionId =>
                            this._server.getCollection(context, this._spaceId, collectionId),
                    },
                );

                referencedTaskById.set(newTask.id, {
                    task: newTask,
                    isAccessAuthorizedPromise,
                });

                eventBuilder.waitUntil(
                    isAccessAuthorizedPromise.then(isAccessAuthorized => {
                        if (!isAccessAuthorized) {
                            eventBuilder.addUnauthorizedTaskBackfill(this._sender, newTask.id);
                        } else {
                            eventBuilder.addAuthorizedTaskBackfill(this._sender, newTask);
                        }
                    }),
                );
            },
            onReferencedTaskUpdate: (context, eventBuilder, taskId, oldTask, newTask, actions) => {
                const referencedTask = referencedTaskById.get(taskId);
                assert(referencedTask?.task === oldTask);
                referencedTask.task = newTask;

                // Only add update actions for this referenced task if the referenced task
                // is authorized.
                eventBuilder.waitUntil(
                    referencedTask.isAccessAuthorizedPromise.then(isAccessAuthorized => {
                        if (!isAccessAuthorized) return;
                        eventBuilder.addActions(this._sender, actions);
                    }),
                );
            },
            onReferencedTaskRemove: (context, eventBuilder, oldTask) => {
                const referencedTask = referencedTaskById.get(oldTask.id);
                assert(referencedTask?.task === oldTask);
                referencedTaskById.delete(oldTask.id);
            },
            onReferencedCollectionAdd: (context, eventBuilder, newCollection) => {
                const referencedCollection = referencedCollectionById.get(newCollection.id);
                assert(!referencedCollection);

                const isAccessAuthorizedPromise = isTaskCollectionIndexDocAccessAuthorized(
                    context,
                    this._accountId,
                    newCollection,
                    "View",
                );

                referencedCollectionById.set(newCollection.id, {
                    collection: newCollection,
                    isAccessAuthorizedPromise,
                });

                eventBuilder.waitUntil(
                    isAccessAuthorizedPromise.then(isAccessAuthorized => {
                        if (!isAccessAuthorized) {
                            eventBuilder.addUnauthorizedCollectionBackfill(
                                this._sender,
                                newCollection.id,
                            );
                        } else {
                            eventBuilder.addAuthorizedCollectionBackfill(
                                this._sender,
                                newCollection,
                            );
                        }
                    }),
                );
            },
            onReferencedCollectionUpdate: (
                context,
                eventBuilder,
                collectionId,
                oldCollection,
                newCollection,
                actions,
            ) => {
                const referencedCollection = referencedCollectionById.get(collectionId);
                assert(referencedCollection?.collection === oldCollection);
                referencedCollection.collection = newCollection;

                // Only add update actions for this referenced task if the referenced task
                // is authorized.
                eventBuilder.waitUntil(
                    referencedCollection.isAccessAuthorizedPromise.then(isAccessAuthorized => {
                        if (!isAccessAuthorized) return;
                        eventBuilder.addActions(this._sender, actions);
                    }),
                );
            },
            onReferencedCollectionRemove: (context, eventBuilder, oldCollection) => {
                const referencedCollection = referencedCollectionById.get(oldCollection.id);
                assert(referencedCollection?.collection === oldCollection);
                referencedCollectionById.delete(oldCollection.id);
            },
            onAuthorize: async (context, eventBuilder) => {
                // Create a clone of `referencedTaskById` while we're reauthorizing. Tasks may
                // become unreferenced/referenced while we're authorizing and we don't want
                // that to affect us.
                const reauthorizingReferencedTaskById = new Map(referencedTaskById);
                const reauthorizingReferencedCollectionById = new Map(referencedCollectionById);

                const authorizationPromise = runAllPromises(
                    concatIterables(
                        mapIterable(
                            reauthorizingReferencedTaskById.values(),
                            async referencedTask => {
                                // It is important we capture a synchronous reference to `task` here at
                                // the start since `task` may update concurrently.
                                const {task} = referencedTask;

                                const newIsAccessAuthorizedPromise = isTaskIndexDocAccessAuthorized(
                                    context,
                                    this._accountId,
                                    task,
                                    "View",
                                    {
                                        getTaskIndexDoc: taskId =>
                                            this._server.getTask(context, this._spaceId, taskId),
                                        getCollectionIndexDoc: collectionId =>
                                            this._server.getCollection(
                                                context,
                                                this._spaceId,
                                                collectionId,
                                            ),
                                    },
                                );

                                const oldIsAccessAuthorizedPromise =
                                    referencedTask.isAccessAuthorizedPromise;
                                referencedTask.isAccessAuthorizedPromise =
                                    newIsAccessAuthorizedPromise;

                                // NOCOMMIT: I don't believe anymore event order will be strongly maintained.
                                // Even though we wait for the old access promise there may be a slow load
                                // blocking the update its included in. I think we need some kind of version?
                                const [oldIsAccessAuthorized, newIsAccessAuthorized] =
                                    await runAllPromises([
                                        oldIsAccessAuthorizedPromise,
                                        newIsAccessAuthorizedPromise,
                                    ]);

                                if (oldIsAccessAuthorized !== newIsAccessAuthorized) {
                                    if (!newIsAccessAuthorized) {
                                        eventBuilder.addUnauthorizedTaskBackfill(
                                            this._sender,
                                            task.id,
                                        );
                                    } else {
                                        eventBuilder.addAuthorizedTaskBackfill(this._sender, task);
                                    }
                                }
                            },
                        ),
                        mapIterable(
                            reauthorizingReferencedCollectionById.values(),
                            async referencedCollection => {
                                // It is important we capture a synchronous reference to `collection` here at
                                // the start since `collection` may update concurrently.
                                const {collection} = referencedCollection;

                                const newIsAccessAuthorizedPromise =
                                    isTaskCollectionIndexDocAccessAuthorized(
                                        context,
                                        this._accountId,
                                        collection,
                                        "View",
                                    );

                                const oldIsAccessAuthorizedPromise =
                                    referencedCollection.isAccessAuthorizedPromise;
                                referencedCollection.isAccessAuthorizedPromise =
                                    newIsAccessAuthorizedPromise;

                                // NOCOMMIT: I don't believe anymore event order will be strongly maintained.
                                // Even though we wait for the old access promise there may be a slow load
                                // blocking the update its included in. I think we need some kind of version?
                                const [oldIsAccessAuthorized, newIsAccessAuthorized] =
                                    await runAllPromises([
                                        oldIsAccessAuthorizedPromise,
                                        newIsAccessAuthorizedPromise,
                                    ]);

                                if (oldIsAccessAuthorized !== newIsAccessAuthorized) {
                                    if (!newIsAccessAuthorized) {
                                        eventBuilder.addUnauthorizedCollectionBackfill(
                                            this._sender,
                                            collection.id,
                                        );
                                    } else {
                                        eventBuilder.addAuthorizedCollectionBackfill(
                                            this._sender,
                                            collection,
                                        );
                                    }
                                }
                            },
                        ),
                    ),
                );

                eventBuilder.waitUntil(authorizationPromise);
                await authorizationPromise;
            },
        };
    }
}

/**
 * Prepares an authorized task for the client. We assume the task is authorized
 * by this point but there's still some data within a task clients are not
 * allowed to see. (e.g. The position of this task in the assignee's active
 * section.)
 *
 * We also need to convert the task to a `TaskModel`.
 */
function prepareTaskForClient(accountId: AccountId, task: TaskIndexDoc): TaskModel {
    return new TaskModel({
        id: task.id,
        spaceId: task.spaceId,

        creator: task.creator,
        createdTime: task.createdTime,
        deletedTime: task.rawDeletedTime,
        undeletedTime: task.rawUndeletedTime,

        // NOTE(calebmer, #security): If a task has a parent that we're not authorized
        // to view, we still send the `TaskId` of the parent and the child's
        // `TaskPosition` in the parent. An attacker with technical sophistication
        // could use this to determine which tasks they *can* view share the same
        // parent and their relative positions.
        //
        // Example exploit: Let's say our company is working on a secret project. I and
        // a coworker both are assigned a child task to a parent task in this secret
        // project. We can compare the `parentTaskId` on our secret tasks to know we
        // are working on the same thing.
        //
        // The exploits you can perform with this information aren't that bad and it
        // would be a real pain to hide this information in realtime so we leave it
        // as is for now.
        parent: {
            taskId: task.parent.taskId,
            position: task.parent.rawPosition,
        },
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,

        // NOTE(calebmer, #security): If a task has a collection that we're not
        // authorized to view, we still send the `TaskCollectionId` of the collection
        // and the `TaskPosition` in the collection. An attacker with technical
        // sophistication could use this to determine which tasks they *can* view are
        // in a secret collection.
        //
        // Example exploit: A team's manager might have a private "evidence for firing"
        // collection for an employee. You could observe that multiple tasks in a
        // shared team collection have this private `TaskCollectionId` and they're all
        // tasks of a certain employee and you might be able to guess what the
        // collection is for.
        //
        // The exploits you can perform with this information aren't that bad and it
        // would be a real pain to hide this information in realtime so we leave it
        // as is for now.
        collections: task.collections.raw.collections,
        positionByCollectionId: task.collections.raw.positionById,

        // Account is only allowed to see the positions of tasks in their own notepad
        // pages. The session account never changes so this doesn't need to respond in
        // realtime.
        positionByAccountIdAndNotepadPageId: reduceIterable(
            filterIterable(task.notepadPages.raw.positionById.actualEntries(), ([key]) =>
                key.startsWith(accountId),
            ),
            (positionById, [key, {value, version}]) =>
                value !== null
                    ? positionById.apply({type: "Set", key, value, version})
                    : // It's important that we also add deleted values to the map so if an event is
                      // a position update is received out-of-order the delete wins.
                      positionById.apply({type: "Delete", key, version}),
            TaskPositionByAccountIdAndNotepadPageIdMap.empty,
        ),

        status: task.status,
        assignee: task.assignee,
        assigneeStatus: new TaskAssigneeStatusRegister(
            task.rawAssigneeStatus.value.type === "Active"
                ? {
                      type: "Active",
                      activatedTime: task.rawAssigneeStatus.value.activatedTime,
                      // You are not allowed to see the active task position for other accounts. So
                      // replace with a dummy position that never changes to satisfy the types.
                      position:
                          !task.assignee.value ||
                          task.assignee.value.assignee.accountId !== accountId
                              ? {
                                    orderTime: task.rawAssigneeStatus.version,
                                    orderKey: initialOrderKey,
                                }
                              : task.rawAssigneeStatus.value.position,
                  }
                : {type: "Inactive"},
            task.rawAssigneeStatus.version,
        ),

        title: task.title.raw,
        dueDate: task.dueDate,
        priority: task.priority,
    });
}

function prepareTaskCollectionForClient(collection: TaskCollectionIndexDoc): TaskCollectionModel {
    return new TaskCollectionModel({
        id: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        deletedTime: collection.rawDeletedTime,
        undeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        accessPolicy: collection.accessPolicy,
    });
}

/**
 * Prepares a task action before we send it to the client. When we call this
 * function we've already authorized that the `TaskAction` is against an entity
 * the account has access to. However, the action may still contain some data
 * the account is not allowed to see. So filter out that data before sending an
 * event.
 *
 * If this function returns null then we shouldn't send the action to the
 * client.
 */
function prepareTaskActionForClient(accountId: AccountId, action: TaskAction): TaskAction | null {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateParentTaskId":
                case "UpdateParentPosition":
                case "UpdateChildrenCounts":
                case "AddCollection":
                case "RemoveCollection":
                case "UpdateCollectionPosition":
                case "UpdateStatus":
                case "UpdateAssignee":
                case "UpdateTitle":
                case "UpdateDueDate":
                case "UpdatePriority":
                    return action;
                case "UpdateNotepadPagePosition": {
                    if (action.taskAction.accountId !== accountId) return null;
                    return action;
                }
                case "UpdateAssigneeStatus": {
                    // NOTE(calebmer, #security): The order of an account's active tasks is private
                    // to them. We wipe the active task position in `prepareTaskForClient()`
                    // however we can't easily do the same here since we don't know the task
                    // assignee. An attacker would need meaningful technical sophistication to
                    // exploit this.
                    //
                    // Example exploit: An attacker connects a browser to a team collection and
                    // records all `UpdateAssigneeStatus` actions in a database. They do this for a
                    // couple weeks and now they have the active task order for recent tasks of
                    // their coworkers.
                    //
                    // The exploits you can perform with this information aren't that bad and it
                    // would be a real pain to hide this information. One way we could hide this is
                    // change the `UpdateAssigneeStatus` action to be more like the
                    // `UpdateNotepadPagePosition` action. Where we store a different position for
                    // each account. Then we would include `accountId` in this action so we could
                    // filter it out.
                    return action;
                }
                default:
                    throw exhaustive(action.taskAction);
            }
        }
        case "UpdateCollection": {
            switch (action.collectionAction.type) {
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateName":
                case "UpdateAccessPolicy":
                    return action;
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateNotepadPage": {
            cast<"Create">(action.notepadPageAction.type);
            return action;
        }
        default:
            throw exhaustive(action);
    }
}

/**
 * Get all the `AccountId`s referenced by a task model.
 */
function collectReferencedAccountIdsFromTaskModelData(
    accountIds: Set<AccountId>,
    task: TaskModelData,
) {
    accountIds.add(task.creator.accountId);

    if (task.status.value.type === "Closed") {
        accountIds.add(task.status.value.closer.accountId);
    }

    if (task.assignee.value) {
        accountIds.add(task.assignee.value.assignee.accountId);
        accountIds.add(task.assignee.value.assigner.accountId);
    }
}

/**
 * Get all the `AccountId`s referenced by a task action.
 */
function collectReferencedAccountIdsFromTaskAction(accountIds: Set<AccountId>, action: TaskAction) {
    switch (action.type) {
        case "UpdateTask": {
            switch (action.taskAction.type) {
                case "Create": {
                    accountIds.add(action.taskAction.creator.accountId);
                    return;
                }
                case "UpdateNotepadPagePosition": {
                    accountIds.add(action.taskAction.accountId);
                    return;
                }
                case "UpdateStatus": {
                    if (action.taskAction.status.type === "Closed") {
                        accountIds.add(action.taskAction.status.closer.accountId);
                    }
                    return;
                }
                case "UpdateAssignee": {
                    if (action.taskAction.assignee) {
                        accountIds.add(action.taskAction.assignee.assignee.accountId);
                        accountIds.add(action.taskAction.assignee.assigner.accountId);
                    }
                    return;
                }
                case "Delete":
                case "Undelete":
                case "UpdateParentTaskId":
                case "UpdateParentPosition":
                case "UpdateChildrenCounts":
                case "AddCollection":
                case "RemoveCollection":
                case "UpdateCollectionPosition":
                case "UpdateAssigneeStatus":
                case "UpdateTitle":
                case "UpdateDueDate":
                case "UpdatePriority": {
                    return;
                }
                default:
                    throw exhaustive(action.taskAction);
            }
        }
        case "UpdateCollection": {
            switch (action.collectionAction.type) {
                case "Create":
                case "Delete":
                case "Undelete":
                case "UpdateName":
                case "UpdateAccessPolicy": {
                    // The client doesn't expect access policy accounts to be loaded. We'll load
                    // these accounts when the sharing modal opens.
                    return;
                }
                default:
                    throw exhaustive(action.collectionAction);
            }
        }
        case "UpdateNotepadPage": {
            cast<"Create">(action.notepadPageAction.type);
            accountIds.add(action.accountId);
            return action;
        }
        default:
            throw exhaustive(action);
    }
}
