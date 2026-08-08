import {
    WorkerActionContext,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {
    WorkerProcessContext,
    WorkerProcessContextModules,
} from "~/server/cloudflare/context/worker_process_context.js";
import {createDurableObject} from "~/server/cloudflare/create_durable_object.js";
import {
    TaskNotesCollaborationConnection,
    TaskNotesCollaborationEventStub,
} from "~/server/tasks/notes_collaboration/task_notes_collaboration_connection.js";
import {TaskNotesCollaborationContentManager} from "~/server/tasks/notes_collaboration/task_notes_collaboration_content_manager.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {AccessLevel, allAccessLevels, isAccessLevel} from "~/shared/access/access_policy.js";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error.open_source.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.open_source.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastNewMessageRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {diffProsemirrorNodes} from "~/shared/prosemirror/diff_prosemirror_nodes.js";
import {authorizeTaskAccess, getTaskNotesContent} from "~/shared/rpc/tasks_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.open_source.js";
import {
    TaskNotesCollaborationBroadcastTaskActivityRequestBodySchema,
    TaskNotesCollaborationProtocol,
    TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema,
    TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema,
} from "~/shared/tasks/task_notes_collaboration_protocol.js";
import {
    TaskNotesContent,
    TaskNotesContentProsemirrorSchema,
    assertTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";

type TaskNotesCollaborationDurableObjectRoute =
    | {type: "Main"; accessLevel: AccessLevel | null}
    | {type: "BroadcastNewMessage"}
    | {type: "BroadcastPutMessageStreamPart"}
    | {type: "BroadcastCompleteMessageStream"}
    | {type: "BroadcastTaskActivity"}
    | {type: "UpdateContentWithDiff"}
    | {type: "NotFound"};

class TaskNotesCollaborationDurableObject {
    public static readonly serviceName = "TaskNotesCollaborationService";

    private readonly _processContext: WorkerProcessContext;
    public readonly spaceId: SpaceId;
    public readonly taskId: TaskId;
    private readonly _contentManager: TaskNotesCollaborationContentManager;
    private readonly _destroyCallback: () => void;

    private readonly _webSocketServerByAccessLevel: Record<
        AccessLevel,
        WebSocketServer<
            WorkerProcessContextModules,
            WorkerSessionActionContextModules,
            typeof TaskNotesCollaborationProtocol,
            TaskNotesCollaborationEventStub,
            TaskNotesCollaborationConnection
        >
    >;

    public static async initialize({
        processContext,
        initializeActionContext,
        idName,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
    }): Promise<TaskNotesCollaborationDurableObject> {
        const taskId = Schema.id<TaskId>().deserialize(idName);

        const {
            spaceId,
            version: initialVersion,
            content: initialContent,
        } = await getTaskNotesContent(initializeActionContext, {
            taskId,
        });

        return new TaskNotesCollaborationDurableObject({
            processContext,
            spaceId,
            taskId,
            initialVersion,
            initialContent,
            destroy,
        });
    }

    private constructor({
        processContext,
        spaceId,
        taskId,
        initialVersion,
        initialContent,
        destroy,
    }: {
        processContext: WorkerProcessContext;
        spaceId: SpaceId;
        taskId: TaskId;
        initialVersion: number;
        initialContent: TaskNotesContent;
        destroy: () => void;
    }) {
        // Propagate the `TaskId` to all logs for this durable object.
        processContext = processContext.tracer.withPropagatedData({
            context: {spaceId, taskId},
        });

        this._processContext = processContext;
        this.spaceId = spaceId;
        this.taskId = taskId;
        this._destroyCallback = destroy;

        this._contentManager = new TaskNotesCollaborationContentManager({
            spaceId,
            taskId,
            initialVersion,
            initialContent,
            sendEventToAllAndWait: async (context, event) => {
                await runAllPromises(
                    allAccessLevels.map(async accessLevel => {
                        const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                        await webSocketServer.sendEventToAllAndWait(context, event);
                    }),
                );
            },
            killProcess: (context, error) => this._destroy(context, error),
        });

        this._webSocketServerByAccessLevel = createObjectFromKeys(allAccessLevels, accessLevel => {
            return new WebSocketServer<
                WorkerProcessContextModules,
                WorkerSessionActionContextModules,
                typeof TaskNotesCollaborationProtocol,
                TaskNotesCollaborationEventStub,
                TaskNotesCollaborationConnection
            >(
                this._processContext,
                TaskNotesCollaborationProtocol,
                ({
                    accountId,
                    connectionId,
                    closeWithError,
                    sendEvent,
                    sendEventToOthers,
                    iterateOtherConnections,
                }) => {
                    return new TaskNotesCollaborationConnection({
                        accessLevel,
                        connectionId,
                        accountId,
                        contentManager: this._contentManager,
                        closeWithError,
                        killProcess: (context, error) => this._destroy(context, error),
                        sendEvent,
                        sendEventToOthers: (context, event) => {
                            sendEventToOthers(context, event);

                            for (const otherAccessLevel of allAccessLevels) {
                                if (otherAccessLevel === accessLevel) continue;

                                const otherWebSocketServer =
                                    this._webSocketServerByAccessLevel[otherAccessLevel];

                                if (!otherWebSocketServer.hasConnections()) continue;

                                otherWebSocketServer.sendEventToAll(context, event);
                            }
                        },
                        iterateOtherConnections: () =>
                            concatIterables(
                                iterateOtherConnections(),
                                flatMapIterable(allAccessLevels, otherAccessLevel => {
                                    if (otherAccessLevel === accessLevel) return emptyArray;

                                    const otherWebSocketServer =
                                        this._webSocketServerByAccessLevel[otherAccessLevel];

                                    return otherWebSocketServer.iterateAllConnections();
                                }),
                            ),
                    });
                },
            );
        });
    }

    public static parseRoute(url: URL): [string, TaskNotesCollaborationDurableObjectRoute] {
        if (url.pathname === "/") {
            const accessSearchParam = url.searchParams.get("access");
            const accessLevel =
                accessSearchParam && isAccessLevel(accessSearchParam) ? accessSearchParam : null;
            return ["/", {type: "Main", accessLevel}];
        }

        if (url.pathname === "/broadcast-new-message") {
            return [url.pathname, {type: "BroadcastNewMessage"}];
        }

        if (url.pathname === "/broadcast-put-message-stream-part") {
            return [url.pathname, {type: "BroadcastPutMessageStreamPart"}];
        }

        if (url.pathname === "/broadcast-complete-message-stream") {
            return [url.pathname, {type: "BroadcastCompleteMessageStream"}];
        }

        if (url.pathname === "/broadcast-task-activity") {
            return [url.pathname, {type: "BroadcastTaskActivity"}];
        }

        if (url.pathname === "/update-content-with-diff") {
            return [url.pathname, {type: "UpdateContentWithDiff"}];
        }

        return ["/*", {type: "NotFound"}];
    }

    public async fetch(
        context: WorkerActionContext,
        request: Request,
        route: TaskNotesCollaborationDurableObjectRoute,
    ): Promise<Response> {
        // Propagate the `TaskId` to all logs for this durable object.
        context = context.tracer.withPropagatedData({
            context: {spaceId: this.spaceId, taskId: this.taskId},
        });

        switch (route.type) {
            case "NotFound": {
                throw new NotFoundError("Route not found");
            }
            case "Main": {
                if (!route.accessLevel)
                    throw new InvalidArgumentError("Invalid `access` search param");

                return await this._webSocketServerByAccessLevel[route.accessLevel].upgrade(
                    context.actor.authorizeSession(),
                    request,
                );
            }
            case "BroadcastNewMessage": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody = MessagingRealtimeBroadcastNewMessageRequestSchema.deserialize(
                    await request.json(),
                );

                TaskNotesCollaborationConnection.broadcastNewMessage(context, requestBody, () => {
                    return flatMapIterable(allAccessLevels, accessLevel => {
                        const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                        return webSocketServer.iterateAllConnections();
                    });
                });

                return new Response(null, {status: 200});
            }
            case "BroadcastPutMessageStreamPart": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.deserialize(
                        await request.json(),
                    );

                TaskNotesCollaborationConnection.broadcastPutMessageStreamPart(
                    context,
                    requestBody,
                    () => {
                        return flatMapIterable(allAccessLevels, accessLevel => {
                            const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                            return webSocketServer.iterateAllConnections();
                        });
                    },
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastCompleteMessageStream": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.deserialize(
                        await request.json(),
                    );

                TaskNotesCollaborationConnection.broadcastCompleteMessageStream(
                    context,
                    requestBody,
                    () => {
                        return flatMapIterable(allAccessLevels, accessLevel => {
                            const webSocketServer = this._webSocketServerByAccessLevel[accessLevel];
                            return webSocketServer.iterateAllConnections();
                        });
                    },
                );

                return new Response(null, {status: 200});
            }
            case "BroadcastTaskActivity": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                const requestBody =
                    TaskNotesCollaborationBroadcastTaskActivityRequestBodySchema.deserialize(
                        await request.json(),
                    );

                // Everyone connected here can view the task, and activity carries nothing narrower
                // than view access (access policy changes deliberately produce no activity), so
                // every connection gets the same event.
                for (const accessLevel of allAccessLevels) {
                    this._webSocketServerByAccessLevel[accessLevel].sendEventToAll(context, {
                        type: "TaskActivity",
                        events: requestBody.events,
                    });
                }

                return new Response(null, {status: 200});
            }
            case "UpdateContentWithDiff": {
                if (request.method !== "POST") {
                    return new Response("405 Method Not Allowed", {
                        status: 405,
                        headers: {"content-type": "text/plain"},
                    });
                }

                try {
                    const accountContext = context.actor.authorizeAccount();

                    const requestBody =
                        TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema.deserialize(
                            await request.json(),
                        );

                    // Authorizing task access is a round-trip to AWS. Run it in parallel with
                    // computing and applying the update to avoid an extra serial round-trip. The
                    // `update()` call awaits `authorizationPromise` before mutating any durable object
                    // state so an account without access can't put the durable object in a bad state.
                    const authorizationPromise = authorizeTaskAccess(accountContext, {
                        taskId: this.taskId,
                        expectedAccessLevel: "Edit",
                    });

                    const [, {newVersion, newContent, persistencePromise}] = await runAllPromises([
                        authorizationPromise,
                        (async () => {
                            const oldContent = await this._contentManager.getContentAtVersion(
                                accountContext,
                                requestBody.version,
                            );

                            const requestContent = assertTaskNotesContent(
                                TaskNotesContentProsemirrorSchema.nodes.doc.create(
                                    null,
                                    requestBody.content,
                                ),
                            );

                            const steps = diffProsemirrorNodes(oldContent, requestContent);

                            return await this._contentManager.update(accountContext, null, {
                                version: requestBody.version,
                                steps,
                                clientId: generateId(),
                                validationPromise: authorizationPromise,
                            });
                        })(),
                    ]);

                    // Wait for the update to persist before responding so the public API keeps
                    // read-after-write semantics.
                    await persistencePromise;

                    return new Response(
                        JSON.stringify(
                            TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema.serialize(
                                {
                                    ok: true,
                                    spaceId: this.spaceId,
                                    newVersion,
                                    newContent,
                                },
                            ),
                        ),
                        {
                            status: 200,
                            headers: {"content-type": "application/json"},
                        },
                    );
                } catch (error) {
                    return new Response(
                        JSON.stringify(
                            TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema.serialize(
                                {
                                    ok: false,
                                    error,
                                },
                            ),
                        ),
                        {
                            status: isSystemError(error) ? 500 : 400,
                            headers: {"content-type": "application/json"},
                        },
                    );
                }
            }
            default:
                throw exhaustive(route);
        }
    }

    public connectForTest(
        context: WorkerSessionActionContext,
        {accessLevel = "Edit"}: {accessLevel?: AccessLevel} = {},
    ) {
        return this._webSocketServerByAccessLevel[accessLevel].connectForTest(context);
    }

    private _destroy(context: WorkerProcessContext, error: unknown) {
        for (const accessLevel of allAccessLevels) {
            this._webSocketServerByAccessLevel[accessLevel].closeAllWithError(context, error);
        }
        this._destroyCallback();
    }
}

const TaskNotesCollaborationDurableObjectWrapper = createDurableObject(
    TaskNotesCollaborationDurableObject,
);
export {TaskNotesCollaborationDurableObjectWrapper as TaskNotesCollaborationDurableObject};
