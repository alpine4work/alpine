import {getSearchEntityMentionTitleForApi} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {intoApiTaskLayout} from "~/server/api/internal/tasks/internal/into_api_task_layout.js";
import {intoApiTaskStatus} from "~/shared/api/content/closed_source/into_api_task_status.js";
import {
    ApiTaskParentResponse,
    ApiTaskWithoutNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {intoApiAccount} from "~/shared/spaces/into_api_account.js";
import {ApiTaskCollectionCursorEncoder} from "~/shared/tasks/model/api_task_collection_cursor_encoder.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskRealtimeUpdateEvent} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Helper class for converting `TaskModel`s into `ApiTask`s. We use a class because
 * there's some shared computation that can be reused across multiple conversions
 * to improve performance.
 */
export class ApiTaskConverter {
    #backfillTaskById = new Map<
        TaskId,
        {type: "Authorized"; task: TaskModel} | {type: "Unauthorized"; taskId: TaskId}
    >();

    #backfillCollectionById = new Map<
        TaskCollectionId,
        | {type: "Authorized"; collection: TaskCollectionModel}
        | {type: "Unauthorized"; collectionId: TaskCollectionId}
    >();

    #referencedAccountById = new Map<AccountId, AccountModel>();

    #collectionCursorEncoderById = new LazyMap<TaskCollectionId, ApiTaskCollectionCursorEncoder>(
        collectionId => new ApiTaskCollectionCursorEncoder(collectionId),
    );

    constructor(updateEvent: TaskRealtimeUpdateEvent) {
        for (const backfillTask of updateEvent.backfillTasks) {
            if (backfillTask.type === "Authorized") {
                this.#backfillTaskById.set(backfillTask.task.id, backfillTask);
            } else {
                this.#backfillTaskById.set(backfillTask.taskId, backfillTask);
            }
        }

        for (const backfillCollection of updateEvent.backfillCollections) {
            if (backfillCollection.type === "Authorized") {
                this.#backfillCollectionById.set(
                    backfillCollection.collection.id,
                    backfillCollection,
                );
            } else {
                this.#backfillCollectionById.set(
                    backfillCollection.collectionId,
                    backfillCollection,
                );
            }
        }

        for (const account of updateEvent.referencedAccounts) {
            this.#referencedAccountById.set(account.id, account);
        }
    }

    into(
        task: TaskId | TaskModel,
        options: {referencedAccounts?: ReadonlyArray<AccountModel>} = emptyObject,
    ): ApiTaskWithoutNotesResponse {
        if (typeof task === "string") {
            const backfillTask = assertExists(this.#backfillTaskById.get(task));
            assert(backfillTask.type === "Authorized");
            task = backfillTask.task;
        }

        const taskId = task.id;
        const dueDate = task.getDueDate();
        const assigneeId = task.getAssignee()?.assignee.accountId;
        const parent = task.getParent();
        const priority = task.getPriority();

        return {
            id: taskId,
            creator: {id: task.getCreator().accountId},
            status: intoApiTaskStatus(task.getDisplayStatus()),
            title: task.getTitle().getText(),
            assignee:
                assigneeId !== undefined
                    ? intoApiAccount(
                          assertExists(
                              options.referencedAccounts?.find(
                                  account => account.id === assigneeId,
                              ) ?? this.#referencedAccountById.get(assigneeId),
                          ).initialData,
                      )
                    : undefined,
            due: dueDate ? {date: dueDate.toString()} : undefined,
            priority: priority !== null ? {type: priority} : undefined,
            layout: intoApiTaskLayout(task.getLayout()),
            parent: ((): ApiTaskParentResponse | undefined => {
                if (!parent) return;

                const backfillParentTask = assertExists(this.#backfillTaskById.get(parent.taskId));

                // Keep API parent visibility aligned with `prepareTaskForClient()` in
                // `server/tasks/data/prepare_task_for_client.ts`: AppService also exposes parent
                // task IDs even when the parent task itself is not authorized. See that file for
                // the security tradeoff.
                if (backfillParentTask.type === "Unauthorized") {
                    return {
                        task: {
                            id: backfillParentTask.taskId,
                            // This should return "Private task". Perhaps in the future we should add an
                            // `isPrivate: true` tag to the API to communicate programatically that this is a
                            // private task. API consumers shouldn't rely on the title "Private task" for
                            // telling it a parent task is private.
                            title: getSearchEntityMentionTitleForApi(
                                `Task:${backfillParentTask.taskId}`,
                                {isPrivate: true},
                            ),
                            // `into_api_content_with_references.ts` + `into_api_content.ts` return `status` of
                            // `Closed` for private tasks. Emulate the same behavior here.
                            status: intoApiTaskStatus("Closed"),
                        },
                    };
                }

                return {
                    task: {
                        id: backfillParentTask.task.id,
                        title: backfillParentTask.task.getTitle().getText(),
                        status: intoApiTaskStatus(backfillParentTask.task.getDisplayStatus()),
                    },
                };
            })(),
            collections: filterMapArray(
                task.getCollections().getArray(),
                ({collectionId, version}) => {
                    const backfillCollection = assertExists(
                        this.#backfillCollectionById.get(collectionId),
                    );

                    // Hide collections you don't have access to from the API.
                    if (backfillCollection.type === "Unauthorized") return;

                    const {collection} = backfillCollection;

                    const collectionPosition = task.rawData.positionByCollectionId.get(
                        collectionId,
                    ) ?? {
                        orderTime: version,
                        orderKey: initialOrderKey,
                    };

                    return {
                        cursor: this.#collectionCursorEncoderById
                            .get(collectionId)
                            .encode({taskId, collectionPosition}),
                        collection: {
                            id: collectionId,
                            name: collection.getName(),
                        },
                    };
                },
            ),
        };
    }
}
