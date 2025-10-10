import {CalendarDate} from "@internationalized/date";
import {addHours, addMonths, addSeconds, differenceInMonths} from "date-fns";
import murmurhash from "murmurhash";
import {Step} from "prosemirror-transform";
import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {getMessageContentReferencesForNode} from "~/server/content/get_content_references.js";
import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerActionContextModules,
    ServerBotActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {
    ServerMinimalActionContext,
    ServerMinimalBotActionContext,
} from "~/server/context/server_minimal_action_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {messageStreamIndexSearchEntityDelaySeconds} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {processCommentsQuery} from "~/server/messaging/helpers/process_comments_query.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {
    authorizeSpaceAccess,
    getAccount,
    getAccountIfExists,
    isAccountMemberOfSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_actions.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {
    ensureLocalTaskIndexesIfEnabled,
    indexTaskActionTransactionAssumingItsCommitted,
    runIndexTaskInitialAssigneePositionMigrationForTask,
    taskIndexWaitForRefreshDelayMs,
    withSendTaskIndexSearchEntityJobIfNeeded,
} from "~/server/tasks/data/task_index.js";
import {TaskIndexDoc, isTaskIndexDocDeleted} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeProcessContext,
    TaskRealtimeSessionActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyRegister,
    AccessPolicyWithoutGenerations,
    hasAccessLevel,
    maxAccessLevel,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {defaultMaxRetryAttemptCount} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {
    VtencBigUint64Set,
    decodeVtencBigUint64List,
    encodeVtencBigUint64Set,
} from "~/shared/helpers/number/vtenc_big_uint_64_set.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {decodeIdInto, encodeId, generateId, getMinId, idByteLength, isId} from "~/shared/id/id.js";
import {
    AccountId,
    BrowserId,
    FileId,
    SpaceId,
    TaskActionTransactionId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {MessageContent, MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessagePayloadSchema,
    MessageStreamPartPayload,
    MessageStreamPartPayloadSchema,
} from "~/shared/messaging/message_schema.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {IdByteSetSchema} from "~/shared/schema/helpers/id_byte_set_schema.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskAction,
    TaskActionSchema,
    TaskUpdateTaskAction,
    getTaskActionLabel,
} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {printTaskCollectionSearchResultBodyTextSnippet} from "~/shared/tasks/print_task_collection_search_result_body_text_snippet.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {
    createTaskCollectionNotFoundError,
    createTaskCommentNotFoundError,
    createTaskNotFoundError,
    taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
    taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/tasks/task_error_messages.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionStateSchema,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotesContent,
    TaskNotesContentSchema,
    TaskNotesContentWithReferences,
    emptyTaskNotesContent,
    isTaskNotesContent,
} from "~/shared/tasks/task_notes_content_schema.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * The task actions table is the canonical representation of the data in our
 * task system. Everything else is derived from task actions. We should be able
 * to rebuild any of our structures from the task actions table. When an action
 * commits to this table it has been accepted by our system and should
 * propagate to all realtime clients.
 *
 * In practice, we only end up reading the last ~24 hours of task actions as we
 * incrementally keep other databases, like OpenSearch, up-to-date. Eventually
 * we should find a way to archive old actions. We MUST keep old actions around
 * since we consider actions to be the canonical representation of data in our
 * task system but DynamoDB storage is expensive. Realistically old actions
 * are basically only accessed in disaster recovery scenarios so they can go
 * into low cost S3 storage.
 */
const TaskActionTable = DynamoTableSchema.new({
    name: "TaskActions",
    partitions: [
        {
            name: "TaskActions",
            partitionKeyAttributes: {
                /**
                 * The space who's tasks this action affected.
                 */
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "ActionTransaction",
                    sortKeyAttributes: {
                        /**
                         * The time at which the action was accepted. May be different from whatever
                         * `createdTime` or `updatedTime` is reported in the action itself.
                         */
                        committedTime: DynamoKeyAttributeSchema.date,

                        /**
                         * An `Id` for uniquely representing an action. Also used to disambiguate
                         * actions with identical `committedTime`s.
                         */
                        actionTransactionId: DynamoKeyAttributeSchema.id<TaskActionTransactionId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * Actions which should always be atomically applied together.
                         */
                        actions: Schema.array(TaskActionSchema),

                        /**
                         * Has this action transaction been processed? To consider an action
                         * transaction processed we must have:
                         *
                         * 1. Indexed the transaction in OpenSearch
                         * 2. Applied the transaction on all relevant task realtime servers
                         *
                         * We maintain an index of all actions across all spaces that haven't been
                         * processed so we can retry if necessary.
                         */
                        wasProcessed: Schema.boolean,

                        /**
                         * The account who committed this action.
                         *
                         * Nullable since action transactions before 2023-01-02 did not save
                         * the `actorId`.
                         */
                        actorId: Schema.id<AccountId>().nullable().default(null),

                        /**
                         * An optional identifier provided by the client who committed this action.
                         */
                        clientId: Schema.id<TaskRealtimeClientId>().nullable().default(null),
                    }),
                },
            ],
        },
    ],
});

// Allow querying unprocessed action transactions across all spaces.
const UnprocessedActionTransactionsIndex = TaskActionTable.addIndex({
    name: "UnprocessedActionTransactions",
    itemTypes: [{partitionType: "TaskActions", sortRangeType: "ActionTransaction"}],
    partitionKeyAttributes: {
        wasProcessed: DynamoKeyAttributeSchema.boolean,
    },
    sortKeyAttributes: {
        committedTime: DynamoKeyAttributeSchema.date,
    },
    filter: item => !item.wasProcessed,
});

const TaskStatusTypeRegister = createCrdtRegister(
    Schema.enum<TaskStatus["type"]>(["Open", "Closed"]),
);

const TaskAssigneeAccountIdRegister = createCrdtRegister(Schema.id<AccountId>().nullable());

export type TaskStepCountByAccountId = InstanceType<typeof TaskStepCountByAccountId>;

export const TaskStepCountByAccountId = createSchemaLazyTransformClass<
    Uint8Array,
    ReadonlyMap<AccountId, number>
>(Schema.bytes, {
    serialize: stepCountByAccountId => {
        const bytes = new Uint8Array(stepCountByAccountId.size * (idByteLength + 4));
        const view = new DataView(bytes.buffer);

        let byteOffset = 0;
        for (const [accountId, stepCount] of stepCountByAccountId) {
            decodeIdInto(accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            view.setUint32(byteOffset, stepCount);
            byteOffset += 4;
        }

        return bytes;
    },
    deserialize: bytes => {
        const view = new DataView(bytes.buffer);
        const stepCountByAccountId = new Map<AccountId, number>();

        let byteOffset = 0;
        while (byteOffset + idByteLength + 4 <= bytes.byteLength) {
            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const stepCount = view.getUint32(byteOffset);
            byteOffset += 4;

            stepCountByAccountId.set(accountId, stepCount);
        }

        return stepCountByAccountId;
    },
});

/**
 * Data related to tasks. Contains some views of task actions (e.g. the
 * `EssentialAttributes` items) and some data unrelated to task fields which
 * don't participate in querying (like notes, comments, revision history).
 */
const TaskTable = DynamoTableSchema.new({
    name: "Tasks",
    partitions: [
        {
            name: "Account",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                // NOTE(calebmer, 2025-03-18): Remnants of the task notepad feature. We ignore
                // these item at this point but we need minimal handling for backwards
                // compatibility to avoid crashes since we have objects of this type saved in
                // the database.
                {
                    name: "Notepad",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        pageIds: (
                            Schema.bytes as Schema<any> as Schema<VtencBigUint64Set>
                        ).transform<ReadonlySet<number>>({
                            serialize: ids => encodeVtencBigUint64Set(mapIterable(ids, BigInt)),
                            deserialize: compressedIds =>
                                new Set(
                                    mapIterable(decodeVtencBigUint64List(compressedIds), Number),
                                ),
                        }),
                    }),
                },

                // NOTE(calebmer, 2024-05-20): This exists for backwards compatibility purposes
                // only. Task collections had affinity points before we implemented the generic
                // search affinity system. We've sense migrated task collections to use the
                // generic search affinity system but we have to keep this definition around
                // for backwards compatibility. You shouldn't use items of this type!
                // Eventually all the old task collection affinity items will expire and we can
                // remove this.
                {
                    name: "TaskCollectionAffinity",
                    sortKeyAttributes: {
                        collectionId: DynamoKeyAttributeSchema.id<TaskCollectionId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        points: Schema.float,
                        lastUpdatedTime: Schema.integer,
                    }),
                },

                /**
                 * When an account performs an action that causes them to lose access to some
                 * task, we grant them temporary permission to execute some actions that will
                 * undo that change in case they made a mistake. The account's permission to do
                 * so is represented by a "lease". Given the ability to take action on a task
                 * you no longer have access to is powerful in the hands of an attacker, leases
                 * have the following restrictions:
                 *
                 * 1. You must be allowed to commit the actions at the time the lease is created
                 * 2. Leases live for a short time (<1 day)
                 * 3. If another account updates a task you have a lease for, your lease is
                 *    invalidated
                 *
                 * ## Creating a lease
                 *
                 * You create a lease alongside some other action transaction you're trying to
                 * commit. For efficiency, we only create the lease if the action transaction
                 * you're committing causes the action transaction you're leasing to not be
                 * allowed. If you don't _need_ a lease, we don't bother creating one.
                 *
                 * The client only asks to create a lease if the task it's updating leaves its
                 * view. Then it tries to create a lease with the action transaction that
                 * caused the task to leave.
                 *
                 * We don't check that the actions you're leasing are an inversion of the
                 * actions you're committing (even though that's what we expect from the
                 * client). If an attack provides an unrelated set of actions that's ok. Leases
                 * extend how long you can commit actions that were valid at the time of lease
                 * creation. So actions must be safe when leased in the first place.
                 *
                 * ## Why restriction 3?
                 *
                 * Updating a task in any way invalidates any lease currently held on
                 * the task. Example attack this protects against:
                 *
                 * 1. Manager assigns a task to their report asking them to fill out their
                 *    performance self review
                 * 2. Report fills out the self review section and assigns it back to the
                 *    manager (creating a lease to add them back as the assignee)
                 * 3. After the manager fills out their notes, the report executes the lease.
                 *    Bringing the task back to them so they can see the private notes.
                 *
                 * By invalidating a lease after an update sophisticated users can't do this
                 * attack.
                 *
                 * In principle, a user could be allowed to permanently view a task at the
                 * moment they lost access. Since a user could trivially copy the task down to
                 * their computer while they have access. However a user is not allowed to see
                 * new updates after they lose access. (In practice, a user can see updates
                 * until `WebSocketServer` reauthorizes their WebSocket connection which may
                 * take a couple minutes.) Invalidating leases prevents the user from seeing
                 * new updates after they lose access.
                 *
                 * (In the example attack we propose, a regular user could still add the task
                 * to a private collection of theirs to retain access, this is expected. This
                 * case shouldn't weaken our security posture elsewhere. We may need protection
                 * against retaining access with a private collection someday.)
                 */
                {
                    name: "TaskActionTransactionLease",
                    sortKeyAttributes: {
                        leaseId: DynamoKeyAttributeSchema.id<TaskActionTransactionLeaseId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        actions: Schema.array(TaskActionSchema),
                    }),
                },
            ],
        },
        {
            name: "TaskCollection",
            partitionKeyAttributes: {
                collectionId: DynamoKeyAttributeSchema.id<TaskCollectionId>(),
            },
            sortRanges: [
                {
                    name: "EssentialAttributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        createdTime: HybridLogicalTimeSchema,

                        /**
                         * The account who created this collection. Unlike tasks, the `creatorId` does
                         * not influence permissions. Only the `accessPolicy` influences permissions.
                         * The collection creator may lose access if they are removed from the
                         * `accessPolicy`.
                         */
                        creatorId: Schema.id<AccountId>().nullable().default(null),

                        // We keep track of both `rawDeletedTime` and `rawUndeletedTime` for our
                        // collection in DynamoDB so we can create a full `TaskCollectionModel`. The
                        // collection is considered deleted if `rawDeletedTime` is null or
                        // `rawUndeletedTime` is larger than `rawDeletedTime`.
                        rawDeletedTime: HybridLogicalTimeSchema.nullable(),
                        rawUndeletedTime: HybridLogicalTimeSchema.nullable(),

                        // We include the `name` and `color` of our collection in its
                        // `EssentialAttributes` since we load the `EssentialAttributes` object to
                        // render searched collections.
                        name: LabelStringRegister.schema,
                        color: TaskCollectionColorRegister.schema,

                        /**
                         * Who is allowed to access the collection and with what permission
                         * level.
                         */
                        accessPolicy: AccessPolicyRegister.schema,

                        /**
                         * Have we added a feed candidate entry for the collection? We add an entry
                         * when the collection is shared with some `defaultGrant`. But if you revoke
                         * the `defaultGrant` then add it again we don't want to add another feed
                         * candidate entry.
                         */
                        hasAddedFeedCandidateEntry: Schema.boolean.default(false),

                        /**
                         * The total number of tasks in the collection. Open and closed. Not
                         * including deleted tasks.
                         *
                         * Doesn't use the same `addedChildTaskCount`/`removedChildTaskCount` format
                         * as a task since these numbers aren't shared over realtime (since they would
                         * update so frequently). Though if we wanted to migrate to that format it
                         * should be pretty easy: rename this property to `addedTaskCount` and add a
                         * `removedTaskCount` property that defaults to 0.
                         */
                        taskCount: Schema.integer,

                        /**
                         * The number of open tasks in the collection. Not including deleted tasks. You
                         * can figure out the number of closed tasks with `taskCount - openTaskCount`.
                         */
                        openTaskCount: Schema.integer,

                        /**
                         * The last time a task was added to this collection.
                         *
                         * We present this to users as the task's last updated time.
                         *
                         * Unfortunately, DynamoDB doesn't have a `max()` function in update
                         * expressions so we can't update this perfectly atomically. This value may not
                         * monotonically go forwards and instead temporarily go backwards if we commit
                         * an action with an older time than an action we previously committed.
                         */
                        lastTaskAddedTime: HybridLogicalTimeSchema.nullable(),
                    }),
                },
            ],
        },
        {
            name: "Task",
            partitionKeyAttributes: {
                taskId: DynamoKeyAttributeSchema.id<TaskId>(),
            },
            sortRanges: [
                {
                    name: "EssentialAttributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The account who created this task. The creator of a task always has edit
                         * level permission to the task.
                         */
                        creatorId: Schema.id<AccountId>(),

                        /**
                         * The time this task was created.
                         */
                        createdTime: HybridLogicalTimeSchema,

                        /**
                         * The time this task was deleted. We keep a record of deleted tasks so they
                         * may be undeleted. It's critical to check this property when looking at task
                         * items so you know whether it's been deleted or not.
                         */
                        deletedTime: HybridLogicalTimeSchema.nullable(),

                        /**
                         * The status of this task. Either `Open` or `Closed`.
                         */
                        statusType: TaskStatusTypeRegister.schema,

                        /**
                         * The parent of this task.
                         *
                         * ## Permissions
                         *
                         * We inherit permissions from this task. So if you have edit access to the
                         * parent task then you also have edit access to this task.
                         *
                         * You may have broader permissions to a child task. For example, you can edit
                         * a child task but not its parent task. Or view a child task but not its
                         * parent task.
                         *
                         * ## Parent deletion
                         *
                         * When a parent task is deleted we don't update the `parentTaskId` attribute
                         * of child tasks. You must be careful to check that the `parentTaskId` task
                         * actually exists and is not deleted. We leave gravestones around for deleted
                         * tasks so you should always be able to find a task object even if it's
                         * deleted.
                         *
                         * If the parent task is undeleted the child task is again unaffected.
                         *
                         * ## Depth and circular dependency restrictions
                         *
                         * There is no restriction on how deep you can nest child tasks.
                         *
                         * Task circular dependencies are not allowed. Though clients may temporarily
                         * have circular dependencies. This is because:
                         *
                         * - Task actions may be applied out-of-order
                         * - We may not load the entire task parent hierarchy so we won't know to
                         *   reject an operation that creates a circular dependency
                         *
                         * So clients should be careful not to crash on circular dependencies. However,
                         * a canonical task representation will never have circular dependencies.
                         *
                         * There may also be items in this table that have a circular dependency
                         * because deleted tasks do not count in a dependency chain. If you are
                         * iterating through a parent task chain, make sure to `break` if you see a
                         * deleted parent task.
                         */
                        parentTaskId: TaskParentTaskIdRegister.schema,

                        // See the documentation of `TaskUpdateChildrenCountsAction` for more
                        // information.
                        addedChildTaskCount: Schema.integer,
                        removedChildTaskCount: Schema.integer,
                        addedClosedChildTaskCount: Schema.integer,
                        removedClosedChildTaskCount: Schema.integer,

                        /**
                         * All of this task's current children.
                         *
                         * Stored in binary since that's much more space efficient than storing as
                         * strings. 1kb (used by 1 WCU) costs ~64 128 bit `Id`s.
                         *
                         * Unlike `addedChildTaskCount` these are our current child tasks. If a child
                         * task is removed then we remove it from the set. If a child task is deleted
                         * it stays in the set, though.
                         */
                        childTaskIds: IdByteSetSchema.get<TaskId>(),

                        /**
                         * The collections this task is a part of. A task inherits the highest access
                         * level from its collections.
                         */
                        collections: TaskCollectionSet.schema,

                        /**
                         * The account which was assigned this task.
                         */
                        assigneeId: TaskAssigneeAccountIdRegister.schema,

                        /**
                         * Leases are valid as long as the task is unmodified. This is how we keep
                         * track of that. When we create a lease it's set here. When the task is
                         * modified this is set to null.
                         */
                        validLeaseId: Schema.id<TaskActionTransactionLeaseId>()
                            .nullable()
                            .default(null),
                    }),
                },

                /**
                 * Information regarding the task's comments. Including comment count and the
                 * next comment index.
                 */
                // NOTE(calebmer, 2024-06-05): Comment information is in a separate DynamoDB
                // item for tasks unlike the `commentsSummary` or `messagesSummary` properties
                // in the chat, forum, and document messaging systems which live in the main
                // attributes object for their respective entities. It's hard to predict
                // without sufficient production data, but I'm starting to suspect that for
                // messaging rooms that themselves carry a lot of data (just posts and tasks
                // right now) it may be more efficient to have a separate `CommentsSummary`
                // item than to have a `commentsSummary` property on the main item.
                //
                // If we had a `commentsSummary` property in a task's `EssentialAttributes`
                // item then if the combined object exceeds 1kb we have to pay an extra
                // DynamoDB WCU when either updating `EssentialAttributes` or
                // creating/updating any comment. In binary ~7 `Id`s (at 128 bits each) are
                // enough to fill a 1kb WCU. So a separate `CommentsSummary` item saves WCUs.
                //
                // A separate `CommentsSummary` item doesn't increase our DynamoDB read cost
                // (RCUs) if we're careful to read them with a DynamoDB `query()` (instead of
                // `getItem()`) since they're physically next to each other on disk.
                {
                    name: "CommentsSummary",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The index of the next comment.
                         */
                        nextCommentIndex: Schema.integer.min(0),

                        /**
                         * The last time a comment was changed. This should equal the `changeTime` of
                         * the highest item in `CommentChangeLog`.
                         */
                        lastChangeTime: Schema.date.nullable().default(null),

                        /**
                         * All the accounts which have commented on the task and the number of comments
                         * they have made. The map is ordered by when the account first commented on
                         * the task.
                         *
                         * This map can grow unbounded. When a user deletes a comment it leaves a
                         * gravestone so comment counts should never be decremented.
                         */
                        commentCountByAuthorId: Schema.map(
                            Schema.id<AccountId>(),
                            Schema.integer.min(1),
                        ),

                        /**
                         * All the accounts which have been mentioned at some point in the task's
                         * comments or task's content and how many times the account was mentioned.
                         *
                         * Accounts that exist in the map with a mention count of zero have a
                         * special meaning:
                         *
                         * - If an account exists in the map they were mentioned at some point
                         * - If an account exists in the map with a mention count of zero then they
                         *   were mentioned at some point but all mentions have been removed by updates
                         * - If an account does not exist in the map they were never mentioned in
                         *   the task
                         **/
                        mentionCountByAccountId: Schema.map(
                            Schema.id<AccountId>(),
                            Schema.integer.min(0),
                        ).default(new Map()),
                    }),
                },

                /**
                 * All queryable task data is updated through `TaskAction`s and indexed in
                 * OpenSearch. Task notes are a freeform, collaborative, text area that's not
                 * queryable. We store task notes in DynamoDB which is a completely separate
                 * read/write path for task notes to avoid paying the storage cost of putting
                 * notes in OpenSearch and the load cost of frequent writes on
                 * `TaskRealtimeService`.
                 *
                 * Reading and writing task notes needs basically the same implementation as
                 * document content. However, since we expect task notes to be shorter, less
                 * collaborative, and unlikely to be edited after they're initially written
                 * we're going for a simpler implementation of realtime content editing.
                 *
                 * A notable difference between this collaborative content implementation and
                 * our document collaborative content implementation is we don't keep track of
                 * all steps ever applied to the task. Since we don't care about showing a full
                 * content version history for task notes (like we want to show for documents).
                 * We do want to have a task activity feed but that's a separate system.
                 *
                 * Using Y.js would be nice. However, Y.js replaces the whole document whenever
                 * a change occurs which doesn't play nice with [ProseMirror decorations and
                 * other plugins][1]. Having a single collaborative framework to deal with for
                 * `<ContentEditor>` simplifies developing out our editor.
                 *
                 * [1]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488/5
                 */
                {
                    name: "Notes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The space the task is in. Copied from our `EssentialAttributes` item to
                         * avoid an extra fetch when we just need the `SpaceId`.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The current content version. Keeps track of the number of steps taken
                         * against this content.
                         */
                        version: Schema.integer,

                        /**
                         * The current notes content.
                         */
                        content: TaskNotesContentSchema,

                        /**
                         * Keep track of the number of steps contributed by various `AccountId`s after
                         * `version` 0. Excluding steps contributed by `creatorId`. You can compute
                         * `creatorId`'s `stepCount` by adding all step counts in this map then
                         * subtracting that from `version`.
                         *
                         * This is a simple way to determine who's contributed to the task and by
                         * what amount. However, this is only a valid measure of the amount each
                         * account has contributed assuming the relative added content size of each
                         * step is the same. It's possible an account pastes a lot of content and
                         * that's only counted as one step. Approaches of measuring contribution that
                         * take pastes into effect would be less efficient and more prone to error.
                         *
                         * We serialize the map to binary. An `Id` is 128 bits in binary and 208 bits
                         * in UTF-8. That means for one 4kb DynamoDB read unit we can fit 250 `Id`s in
                         * binary but only 153 `Id`s in UTF-8.
                         *
                         * This map was not around prior to 2024-01-01. So documents created before
                         * then (and until this deploys) will not have an accurate step count map. All
                         * steps will be counted towards the `creatorId`.
                         *
                         * You can add this to the `continuousActionCount` property of
                         * `approximateActionCountByAccountId` to get an overall relative measure of
                         * contribution for the task.
                         */
                        stepCountByAccountId: TaskStepCountByAccountId.schema.default(
                            new TaskStepCountByAccountId(new Map()),
                        ),
                    }),
                },

                /**
                 * Comments on a task. Has all the attributes needed for a message in
                 * `MessageInterface`.
                 */
                {
                    name: "Comments",
                    sortKeyAttributes: {
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: Schema.object({
                                // We duplicate `authorId` here to easily check if the bot is allowed to update
                                // the stream.
                                authorId: Schema.id<AccountId>(),

                                /**
                                 * When the stream was completed. If null then the stream hasn't been
                                 * finished so we should expect more updates!
                                 *
                                 * If a stream hasn't completed for some period of time since creation (a
                                 * couple hours) then we consider the stream to be completed whether or not
                                 * it actually has been completed.
                                 */
                                completedTime: Schema.date.nullable(),

                                /**
                                 * The number of parts in the stream so far. A bot can only ever create
                                 * new parts or update the last part in the stream.
                                 */
                                partCount: Schema.integer.min(0),

                                /**
                                 * The current `updateLockVersion` of the last part in the stream.
                                 */
                                lastPartUpdateLockVersion: Schema.integer.min(0).nullable(),

                                /**
                                 * The last `IndexSearchEntity` job that was sent for this stream. We send an
                                 * `IndexSearchEntity` job once every 10 seconds.
                                 */
                                lastIndexSearchEntityJob: Schema.object({
                                    sendTime: Schema.date,
                                    delaySeconds: Schema.integer.min(0),
                                }),
                            }),
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: Schema.object({
                                payload: MessageStreamPartPayloadSchema,
                            }),
                        },
                    ],
                },

                /**
                 * We keep a log of changes to comments so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in the `CommentsSummary` item.
                 *
                 * This log does not include when comments are created, only updated or
                 * deleted. Because comment indexes are dense we can take the last seen comment
                 * index and load comments after that to backfill.
                 *
                 * Log items will expire after a certain amount of time. If a client hasn't
                 * backfilled in a long time it will need to fully reload since we won't know
                 * what changed.
                 */
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                                // `contentUpdatedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                                // `deletedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                        }),
                    }),
                },
            ],
        },
        {
            name: "TaskGridViewExpansionState",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                browserId: DynamoKeyAttributeSchema.id<BrowserId>(),
                viewKey: DynamoKeyAttributeSchema.labelString(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        // Store state as a string in DynamoDB to get around DynamoDB's object nesting
                        // limits since this is a recursive data type. (Ideally binary someday.)
                        state: Schema.unknown().transform<TaskGridViewExpansionState>({
                            serialize: state =>
                                JSON.stringify(TaskGridViewExpansionStateSchema.serialize(state)),
                            deserialize: state =>
                                typeof state === "string"
                                    ? TaskGridViewExpansionStateSchema.deserialize(
                                          JSON.parse(state),
                                      )
                                    : TaskGridViewExpansionStateSchema.deserialize(state),
                        }),
                    }),
                },
            ],
        },
    ],
});

type TaskActionTransactionItem = DynamoTableItemType<
    typeof TaskActionTable,
    "TaskActions",
    "ActionTransaction"
>;

type TaskAccountActionTransactionLeaseItem = DynamoTableItemType<
    typeof TaskTable,
    "Account",
    "TaskActionTransactionLease"
>;

export type TaskEssentialAttributesItem = DynamoTableItemType<
    typeof TaskTable,
    "Task",
    "EssentialAttributes"
>;

type TaskCommentsSummaryItem = DynamoTableItemType<typeof TaskTable, "Task", "CommentsSummary">;

type TaskEssentialAttributesItemBase = Omit<
    TaskEssentialAttributesItem,
    "childTaskIds" | "validLeaseId"
>;

export type TaskCollectionEssentialAttributesItem = DynamoTableItemType<
    typeof TaskTable,
    "TaskCollection",
    "EssentialAttributes"
>;

type TaskCollectionEssentialAttributesItemBase = Omit<
    TaskCollectionEssentialAttributesItem,
    "taskCount" | "openTaskCount" | "lastTaskAddedTime" | "hasAddedFeedCandidateEntry"
>;

type TaskNotesItem = DynamoTableItemType<typeof TaskTable, "Task", "Notes">;

// Authorizers must be declared next to their respective Tables
export const FileTaskAuthorizer = FileAuthorizer.new(
    TaskTable,
    "Task",
    async (context, target, spaceId, expectedAccessLevel) => {
        switch (target.type) {
            case "TaskNotes":
                await authorizeTaskAccess(context, target.taskId, expectedAccessLevel);
                break;
            case "TaskComments":
                await authorizeTaskAccess(context, target.taskId, "Comment");
                break;
            default:
                throw exhaustive(target);
        }
    },
);

/**
 * Scan every task and task collection in our database. Use when
 * migrating data.
 */
export async function* expensiveScanEveryTaskAndTaskCollectionForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Task"; spaceId: SpaceId; taskId: TaskId}
    | {type: "TaskCollection"; spaceId: SpaceId; collectionId: TaskCollectionId}
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    for await (const item of TaskTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Task", sortRangeType: "EssentialAttributes"},
            {partitionType: "TaskCollection", sortRangeType: "EssentialAttributes"},
        ],
    })) {
        if (item.partitionType === "Task") {
            if (item.sortRangeType !== "EssentialAttributes") continue;
            yield {type: "Task", spaceId: item.spaceId, taskId: item.taskId};
        } else if (item.partitionType === "TaskCollection") {
            if (item.sortRangeType !== "EssentialAttributes") continue;
            yield {type: "TaskCollection", spaceId: item.spaceId, collectionId: item.collectionId};
        }
    }
}

/**
 * We added `assigneePosition` on 2025-03-10. This migration makes sure
 * `rawAssigneePosition` and `assigneePosition` exist on every task in
 * OpenSearch.
 */
export async function runIndexTaskInitialAssigneePositionMigration(
    context: Context<DynamoContextModules & {opensearch: OpensearchContextModule}>,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    let i = 0;
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(5, () => new Mutex());

    for await (const item of TaskTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [{partitionType: "Task", sortRangeType: "EssentialAttributes"}],
    })) {
        assert(item.partitionType === "Task" && item.sortRangeType === "EssentialAttributes");

        promiseWaiter.waitUntil(
            mutexes[i++ % mutexes.length]!.withLock(() =>
                runIndexTaskInitialAssigneePositionMigrationForTask(
                    context,
                    item.spaceId,
                    item.taskId,
                ),
            ),
        );
    }

    await promiseWaiter.wait();
}

/**
 * Reindex every task action in our task actions table to rebuild our task
 * OpenSearch index.
 *
 * This migration needs to be run in two steps. The first step creates all the
 * task docs in OpenSearch. The second step applies all non-create updates. We
 * need to create docs first since if an update action doesn't find the task
 * doc it's updating it'll retry until the task doc exists. We can't guarantee
 * the scan will find create actions first so we run the migration in two
 * steps to guarantee tasks are created before updated.
 */
export async function runIndexEveryTaskActionStep1Of2(
    context: TaskRealtimeProcessContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    const {serviceName: unknownServiceName} = context.tracer.getRoot();
    assert(unknownServiceName === "MigrationService");
    const serviceName = unknownServiceName;

    let i = 0;
    const promiseWaiter = new PromiseWaiter();
    const mutexes = createArrayWithLength(10, () => new Mutex());

    for await (const item of TaskActionTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
    })) {
        const createActions = item.actions.filter(
            action =>
                (action.type === "UpdateTask" && action.taskAction.type === "Create") ||
                (action.type === "UpdateCollection" && action.collectionAction.type === "Create"),
        );
        if (createActions.length === 0) continue;

        promiseWaiter.waitUntil(
            mutexes[i++ % mutexes.length]!.withLock(() =>
                indexTaskActionTransactionAssumingItsCommitted(
                    context.clone({
                        cache: CacheContextModule.new(),
                        batch: BatchContextModule.new(),
                        actor: SystemActorContextModule.dangerouslyNew(serviceName, item.spaceId),
                    }),
                    {...item, actions: createActions},
                    {
                        // Don't record search affinity interactions when backfilling OpenSearch.
                        // Search affinity interactions should only be recorded immediately after the
                        // action is commit.
                        withoutSearchAffinityEntityInteraction: true,
                    },
                ),
            ),
        );
    }

    await promiseWaiter.wait();
}

/**
 * Reindex every task action in our task actions table to rebuild our task
 * OpenSearch index.
 *
 * This migration needs to be run in two steps. The first step creates all the
 * task docs in OpenSearch. The second step applies all non-create updates. We
 * need to create docs first since if an update action doesn't find the task
 * doc it's updating it'll retry until the task doc exists. We can't guarantee
 * the scan will find create actions first so we run the migration in two
 * steps to guarantee tasks are created before updated.
 */
export async function runIndexEveryTaskActionStep2Of2(
    context: TaskRealtimeProcessContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
) {
    const {serviceName: unknownServiceName} = context.tracer.getRoot();
    assert(unknownServiceName === "MigrationService");
    const serviceName = unknownServiceName;

    const promiseWaiter = new PromiseWaiter();
    let concurrencyMutexSequence = 0;
    const concurrencyMutexes = createArrayWithLength(10, () => new Mutex());
    const mutexByTaskId = new Map<TaskId, Mutex>();

    for await (const item of TaskActionTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
    })) {
        const updateActions = item.actions.filter(
            action =>
                !(action.type === "UpdateTask" && action.taskAction.type === "Create") &&
                !(action.type === "UpdateCollection" && action.collectionAction.type === "Create"),
        );
        if (updateActions.length === 0) continue;

        let action = () =>
            // Once all our task mutexes unlock, now we wait for a concurrency mutex to
            // unlock before indexing the task.
            concurrencyMutexes[concurrencyMutexSequence++ % concurrencyMutexes.length]!.withLock(
                () =>
                    indexTaskActionTransactionAssumingItsCommitted(
                        context.clone({
                            cache: CacheContextModule.new(),
                            batch: BatchContextModule.new(),
                            actor: SystemActorContextModule.dangerouslyNew(
                                serviceName,
                                item.spaceId,
                            ),
                        }),
                        {...item, actions: updateActions},
                        {
                            // Don't record search affinity interactions when backfilling OpenSearch.
                            // Search affinity interactions should only be recorded immediately after the
                            // action is commit.
                            withoutSearchAffinityEntityInteraction: true,
                            // Perform more retries while indexing during this migration. Since we may have
                            // a lot of update contention while trying to reindex all past actions at once.
                            maxRetryAttemptCount: defaultMaxRetryAttemptCount * 2,
                        },
                    ),
            );

        // We only want one transaction per task to be running at a time. Otherwise the
        // transactions will conflict creating a lot of retries. So we have a mutex per
        // `TaskId` and will only start indexing once the mutex for the first task in
        // the transaction unlocks.
        //
        // This is purely an optimization, it's not necessary for correctness. We could
        // run all actions at the same time and accept retries for tasks trying to
        // update the same data. In practice, I've found this migration has a 50%
        // failure rate since we'll often be updating 20+ `UpdateTitle` actions on the
        // same task at once which are constantly conflicting with each other causing
        // failures.
        //
        // We only use the mutex for the first task in the transaction because
        // otherwise we're at risk of deadlocks. For example, transaction A that
        // updates `task1` then `task2` and another transaction B that updates
        // `task2` then `task1`. If we're not careful, transaction A will lock the
        // mutex for `task1` while transaction B locks the mutex for `task2`. Then
        // transaction A tries to lock the mutex for `task2` as well at the same time
        // transaction B tries to lock the mutex for `task1`. Boom, deadlock!
        //
        // Since we use mutexes mostly as an optimization for when we're indexing many
        // `UpdateTitle` actions at once we think it's acceptable to let conflicting
        // multi-task transactions run (they're rarer and usually not near each other
        // in the database).
        const taskIdForMutex = findMapIterable(updateActions, action =>
            action.type === "UpdateTask" ? action.taskId : undefined,
        );
        if (taskIdForMutex !== undefined) {
            const taskMutex = getOrSetDefaultMapValue(
                mutexByTaskId,
                taskIdForMutex,
                () => new Mutex(),
            );

            const originalAction = action;
            action = () => taskMutex.withLock(originalAction);
        }

        promiseWaiter.waitUntil(action);
    }

    await promiseWaiter.wait();
}

/**
 * Get the item representing a task in unit tests.
 */
export async function getTaskItemForTest(
    context: DynamoContext,
    taskId: TaskId,
): Promise<TaskEssentialAttributesItem> {
    assert(import.meta.jest);

    return TaskTable.getItem(context, {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId,
    });
}

export async function getTaskCommentsSummaryItemIfExistsForTest(
    context: DynamoContext,
    taskId: TaskId,
): Promise<TaskCommentsSummaryItem | null> {
    assert(import.meta.jest);

    return TaskTable.getItemIfExists(context, {
        partitionType: "Task",
        sortRangeType: "CommentsSummary",
        taskId,
    });
}

/**
 * Get the item representing a task collection in unit tests.
 */
export async function getTaskCollectionItemForTest(
    context: DynamoContext,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionEssentialAttributesItem> {
    assert(process.env.NODE_ENV === "test");

    return TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });
}

function isTaskCollectionItemDeleted(
    collectionItem: Pick<
        TaskCollectionEssentialAttributesItem,
        "rawDeletedTime" | "rawUndeletedTime"
    >,
): boolean {
    return (
        !!collectionItem.rawDeletedTime &&
        (!collectionItem.rawUndeletedTime ||
            compareHybridLogicalTimes(
                collectionItem.rawDeletedTime,
                collectionItem.rawUndeletedTime,
            ) > 0)
    );
}

export const commitTaskActionTransactionBeforeExecuteTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * Allow tests to subscribe to committed action transactions
 */
export const afterCommitTaskActionTransactionEventEmitterForTest = import.meta.jest
    ? new EventEmitter<{
          spaceId: SpaceId;
          committedTime: Date;
          actions: ReadonlyArray<TaskAction>;
          clientId: TaskRealtimeClientId | null;
          processPromise: Promise<void>;
      }>()
    : null;

/**
 * Commit a transaction of `TaskAction`s. Authorizes that each action is
 * valid before committing it.
 *
 * When actions are applied to some view they are commutative and idempotent.
 * That means you can apply them in any order and you can apply them multiple
 * times. However, this function is not commutative and idempotent.
 *
 * To successfully commit an action you need to be allowed to modify the data
 * specified in the action. This means committing actions depends on the
 * current state, hence this function can't be commutative.
 *
 * However, because we implement authorization here it means once an action is
 * committed any downstream consumers don't need to factor in authorization
 * rules at all. Downstream consumers can apply actions in any order (thanks to
 * their commutative property) multiple times (thanks to their idempotent
 * property).
 */
export function commitTaskActionTransaction(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskAction>,
    options: {
        clientId?: TaskRealtimeClientId | null;
        leaseId?: TaskActionTransactionLeaseId;
        createLeaseIfLostAccess?: {
            id: TaskActionTransactionLeaseId;
            actions: ReadonlyArray<TaskUpdateTaskAction>;
        };
        updateAccessPolicyShareNotification?: ShareNotification;
        extraTransactionEntries?: Array<DynamoTransactionEntry>;
    } = {},
): Promise<{
    extraActions: ReadonlyArray<TaskAction>;
}> {
    return context.tracer.withSpan("Commit task action transaction", async (context, span) => {
        span.addData({
            tasks: {
                actions: actions.map(getTaskActionLabel).join(","),
                actionCount: actions.length,
            },
        });

        // In our local environment, before committing make sure task indexes exist.
        // That way:
        //
        // 1. If there’s an error creating task indexes it prevents actions from being
        //    committed
        // 2. There are no timeout warnings when processing task actions after they're
        //    committed (since ensuring task indexes may take a while)
        if (process.env.NODE_ENV !== "production") {
            await ensureLocalTaskIndexesIfEnabled(context);
        }

        if (
            options.updateAccessPolicyShareNotification &&
            !actions.some(
                action =>
                    action.type === "UpdateCollection" &&
                    action.collectionAction.type === "UpdateAccessPolicy",
            )
        ) {
            throw new FailedPreconditionError(
                "Can only provide `updateAccessPolicyShareNotification` if there’s an `UpdateAccessPolicy` action in the transaction",
            );
        }

        const {actionTransactionItem, extraActions} = await TaskActionTransactionCommitState.commit(
            context,
            spaceId,
            actions,
            options,
        );

        span.addData({
            tasks: {
                actionTransactionId: actionTransactionItem.actionTransactionId,
            },
        });

        // Make sure we include extra actions in our `TracerSpan` if there were any.
        if (actionTransactionItem.actions.length > 0) {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                },
            });
        }

        const startTime = Date.now();

        const {processPromise} = await afterCommitTaskActionTransaction(
            context,
            actionTransactionItem,
        );

        // Make sure `endTime` is greater than `startTime` in case there was clock
        // skew.
        const endTime = Math.max(startTime, Date.now());

        // Send a notification for all collections updated via the `UpdateAccessPolicy`
        // action in this transaction.
        if (options.updateAccessPolicyShareNotification) {
            for (const action of actions) {
                if (
                    action.type !== "UpdateCollection" ||
                    action.collectionAction.type !== "UpdateAccessPolicy"
                ) {
                    continue;
                }

                context.jobs.send({
                    type: "SendShareNotification",
                    jobId: generateId(),
                    spaceId,
                    actorAccountId: context.actor.getAccountId(),
                    entityId: `TaskCollection:${action.collectionId}`,
                    notification: options.updateAccessPolicyShareNotification,
                });
            }
        }

        // Try and wait until the transaction is processed before returning to the
        // client. We only wait up to 100ms then let the transaction processing
        // finish in the background.
        //
        // Given the client only sends one `commitTaskActionTransaction()` request at a
        // time, this helps reduce conflicts when indexing many sequential actions on
        // the same task (e.g. from typing in the title). And helps other users
        // connected to realtime see these actions in the same order they were made.
        await Promise.race([processPromise.catch(() => {}), wait(100 - (endTime - startTime))]);

        return {extraActions};
    });
}

async function afterCommitTaskActionTransaction(
    context: ServerSessionActionContext,
    actionTransactionItem: TaskActionTransactionItem,
) {
    const processPromise = processTaskActionTransaction(context, actionTransactionItem);

    context.process.waitUntil(processPromise);

    afterCommitTaskActionTransactionEventEmitterForTest?.emit({
        spaceId: actionTransactionItem.spaceId,
        committedTime: actionTransactionItem.committedTime,
        actions: actionTransactionItem.actions,
        clientId: actionTransactionItem.clientId,
        processPromise,
    });

    // Always wait for us to apply the transaction in `TaskRealtimeService`. This
    // allows us to have read-after-write consistency with
    // `commitTaskActionTransaction()` as the write and `context.tasks.loadQuery()`
    // as the read (or anything else that makes a request to
    // `TaskRealtimeService`).
    //
    // If you wait for `commitTaskActionTransaction()` to finish, you're guaranteed
    // any read to a `TaskRealtimeService` instance will see your newly committed
    // data.
    await processPromise.applyActionTransactionInRealtimeServicePromise;

    return {processPromise};
}

/**
 * Query our unprocessed action transaction index and process any transactions
 * that have been in there for too long. It's important for security that we
 * finish processing action transactions within `TaskRealtimeActionHistory`'s
 * 10 minute window.
 *
 * We have a cron job that runs this function once every 3 minutes so we get 3
 * chances in that 10 minute window to process action transactions that failed
 * to process the first time.
 *
 * We add the number of action transactions this function needs to process to
 * the provided `span`.
 */
export async function retryUnprocessedTaskActionTransactions(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    span: TracerSpan,
) {
    const currentTime = Date.now();

    const indexItems = await arrayFromAsyncIterable(
        UnprocessedActionTransactionsIndex.query(context, {
            partitionKey: {wasProcessed: false},
            // Unprocessed action transactions that are less than 12 seconds old are
            // probably being actively processed. Only retry processing after a task has
            // been unprocessed for more than 12 seconds.
            //
            // p99 action transaction processing currently peeks at ~6s.
            endSortKey: {committedTime: new Date(currentTime - 1000 * 12)},
            limit: "All",
        }),
    );

    span.addData({common: {count: indexItems.length}});

    await runAllPromises(
        indexItems.map(async indexItem => {
            const item = await TaskActionTable.getItem(context, indexItem);

            // `UpdateAccountName` actions take a lot longer to process than other actions
            // since they need to wait for the task index to refresh. Don't retry
            // processing of an `UpdateAccountName` action until it has been twice the task
            // index refresh delay interval.
            if (
                item.actions.some(action => action.type === "UpdateAccountName") &&
                item.committedTime.getTime() + taskIndexWaitForRefreshDelayMs * 2 < currentTime
            ) {
                return;
            }

            await processTaskActionTransaction(context, item);
        }),
    );
}

function processTaskActionTransaction(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    actionTransactionItem: TaskActionTransactionItem,
): Promise<void> & {
    applyActionTransactionInRealtimeServicePromise: Promise<void>;
} {
    let applyActionTransactionInRealtimeServicePromise: Promise<void> | null = null;

    const promise = context.tracer.withSpan(
        "Process task action transaction",
        async (context, span) => {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                    actionTransactionId: actionTransactionItem.actionTransactionId,
                },
            });

            applyActionTransactionInRealtimeServicePromise =
                context.tasks.applyActionTransactionInRealtimeService(actionTransactionItem);

            // Process the action transaction in the background.
            await runAllPromises([
                context.tasks.indexActionTransactionAssumingItsCommitted(actionTransactionItem),
                applyActionTransactionInRealtimeServicePromise,
            ]);

            // Once we've finished processing, flip the `wasProcessed` flag to true which
            // will also remove this transaction from our unprocessed transactions index.
            await TaskActionTable.createOrReplaceItem(context, {
                ...actionTransactionItem,
                wasProcessed: true,
            });
        },
    );

    return Object.assign(promise, {
        // Must return the apply action transaction promise separately.
        // `commitTaskActionTransaction()` waits for this before returning.
        applyActionTransactionInRealtimeServicePromise: assertExists(
            cast<Promise<void> | null>(applyActionTransactionInRealtimeServicePromise),
        ),
    });
}

const taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression =
    "SET updateLockVersion = if_not_exists(updateLockVersion, :zero) + :one, taskCount = taskCount + :taskCountDelta, openTaskCount = openTaskCount + :openTaskCountDelta";

/**
 * Abstraction for managing state during a `commitTaskActionTransaction()`
 * call. A task may be updated multiple times within a transaction so we need
 * to keep track of previous writes and return them if another action in the
 * transaction attempts to read again.
 */
class TaskActionTransactionCommitState {
    private readonly _context: ServerSessionActionContext;
    private readonly _spaceId: SpaceId;
    private readonly _leaseId: TaskActionTransactionLeaseId | null;
    private _startTime = Date.now();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByTaskId = new Map<
        TaskId,
        {
            action: "CreateItem" | "DirectlyUpdateItem" | "DirectlyUpdateItemLockVersion";
            taskItem: TaskEssentialAttributesItem;
            shouldCommitExtraUpdateChildrenCountAction: boolean;
        }
    >();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByCollectionId = new Map<
        TaskCollectionId,
        | {action: "CreateItem"; collectionItem: TaskCollectionEssentialAttributesItem}
        | {action: "DirectlyUpdateItem"; collectionItem: TaskCollectionEssentialAttributesItem}
        | {
              action: "AtomicallyUpdateItemAttributes";
              taskCountDelta: number;
              openTaskCountDelta: number;
              lastTaskAddedTime: HybridLogicalTime | null;
          }
    >();

    private readonly _actionTransactionLeaseTransactionEntries: Array<TaskAccountActionTransactionLeaseItem> =
        [];

    private readonly _taskItemById = new Map<TaskId, Promise<TaskEssentialAttributesItem | null>>();
    private readonly _collectionItemById = new Map<
        TaskCollectionId,
        Promise<TaskCollectionEssentialAttributesItem | null>
    >();

    private readonly _afterCommitActions: Array<
        (context: ServerSessionActionContext) => Promise<void>
    > = [];

    private constructor(
        context: ServerSessionActionContext,
        {spaceId, leaseId}: {spaceId: SpaceId; leaseId: TaskActionTransactionLeaseId | null},
    ) {
        this._context = context;
        this._spaceId = spaceId;
        this._leaseId = leaseId;
    }

    public static commit(
        context: ServerSessionActionContext,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskAction>,
        {
            clientId = null,
            leaseId = null,
            createLeaseIfLostAccess,
            extraTransactionEntries,
        }: {
            clientId?: TaskRealtimeClientId | null;
            leaseId?: TaskActionTransactionLeaseId | null;
            createLeaseIfLostAccess?: {
                id: TaskActionTransactionLeaseId;
                actions: ReadonlyArray<TaskUpdateTaskAction>;
            };
            extraTransactionEntries?: Array<DynamoTransactionEntry>;
        },
    ): Promise<{
        actionTransactionItem: TaskActionTransactionItem;
        extraActions: ReadonlyArray<TaskAction>;
    }> {
        return context.dynamo.retryTransaction(async context => {
            await authorizeSpaceAccess(context, spaceId);

            if (!actions[0]) {
                throw new InvalidArgumentError("Must commit at least one action");
            }

            // If the actor is trying to use a lease to authorize their action transaction,
            // make sure the lease is valid before continuing.
            if (leaseId !== null) {
                const leaseItem = await TaskTable.getItemIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "TaskActionTransactionLease",
                    spaceId,
                    accountId: context.actor.getAccountId(),
                    leaseId,
                });

                // If we can't find the lease we attempt to commit without it.
                //
                // - The lease may have expired. In that case the user should get an
                //   authorization failure.
                // - The client may have asked us to create a lease but we detected they don't
                //   need one so we didn't create a lease.
                if (!leaseItem || leaseItem.expirationTime.getTime() < Date.now()) {
                    leaseId = null;
                } else {
                    if (
                        !isDeepEqual(
                            actions.map(action =>
                                omitObject(TaskActionSchema.serialize(action), ["time"]),
                            ),
                            leaseItem.actions.map(action =>
                                omitObject(TaskActionSchema.serialize(action), ["time"]),
                            ),
                        )
                    ) {
                        throw new PermissionDeniedError(
                            "When using a lease, actions must exactly match the previously leased actions (excluding time)",
                        );
                    }
                }
            }

            const state = new TaskActionTransactionCommitState(context, {spaceId, leaseId});
            await state._prepareCommit(actions);

            if (createLeaseIfLostAccess) {
                // The client tries to create a lease when a task leaves its view. If the
                // actions that cause the task to leave would cause the undo actions to fail
                // then we create a lease.
                //
                // This is an optimization. All the data needed to execute this should be
                // cached. Allows us to avoid creating leases when they're unnecessary.
                let hasLostAccess = false;
                try {
                    const forkedState = state._fork();
                    await forkedState._prepareCommit(createLeaseIfLostAccess.actions);

                    assert(
                        forkedState._afterCommitActions.length === 0,
                        "Can’t register after commit callbacks for lease actions since we don’t commit lease actions when creating the lease",
                    );
                } catch (error) {
                    if (error instanceof PermissionDeniedError) {
                        hasLostAccess = true;
                    } else {
                        throw error;
                    }
                }

                if (hasLostAccess) {
                    // Create a new state object and make sure we're allowed to commit the actions
                    // we want a lease for BEFORE the actions that cause us to lose access.
                    try {
                        const testState = new TaskActionTransactionCommitState(context, {
                            spaceId,
                            leaseId: null,
                        });
                        await testState._prepareCommit(createLeaseIfLostAccess.actions);

                        assert(
                            testState._afterCommitActions.length === 0,
                            "Can’t register after commit callbacks for lease actions since we don’t commit lease actions when creating the lease",
                        );
                    } catch (error) {
                        if (error instanceof PermissionDeniedError) {
                            throw PermissionDeniedError.from(error, "Couldn’t apply lease actions");
                        } else {
                            throw error;
                        }
                    }

                    // Mark our lease as valid for all tasks in the transaction...
                    await runAllPromises(
                        createLeaseIfLostAccess.actions.map(async leaseAction => {
                            const task = await state.getTaskItem(leaseAction.taskId);

                            state.updateTaskItem({
                                ...task,
                                validLeaseId: createLeaseIfLostAccess.id,
                            });
                        }),
                    );

                    state._actionTransactionLeaseTransactionEntries.push({
                        partitionType: "Account",
                        sortRangeType: "TaskActionTransactionLease",
                        spaceId,
                        accountId: context.actor.getAccountId(),
                        leaseId: createLeaseIfLostAccess.id,
                        actions: createLeaseIfLostAccess.actions,
                        // Leases have a short expiration time. You may not use a lease after
                        // two hours.
                        expirationTime: addHours(new Date(state._startTime), 2),
                    });
                }
            }

            return state._applyCommit(actions, {
                clientId,
                extraTransactionEntries,
            });
        });
    }

    private async _prepareCommit(actions: ReadonlyArray<TaskAction>): Promise<void> {
        await actuallyCommitTaskActionTransaction(this, this._spaceId, actions);
    }

    private async _applyCommit(
        actions: ReadonlyArray<TaskAction>,
        {
            clientId,
            extraTransactionEntries,
        }: {
            clientId: TaskRealtimeClientId | null;
            extraTransactionEntries?: Array<DynamoTransactionEntry>;
        },
    ) {
        let maxActionTime = actions[0]!.time;
        for (let i = 1; i < actions.length; i++) {
            maxActionTime = maxHybridLogicalTime(maxActionTime, actions[i]!.time);
        }

        const transactionEntries: Array<DynamoTransactionEntry> = [];
        const extraActions: Array<TaskAction> = [];

        for (const transactionEntry of this._transactionEntryByTaskId.values()) {
            switch (transactionEntry.action) {
                case "CreateItem": {
                    transactionEntries.push(
                        TaskTable.transactionCreateItem(transactionEntry.taskItem),
                    );
                    break;
                }
                case "DirectlyUpdateItem": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItem(transactionEntry.taskItem),
                    );
                    break;
                }
                case "DirectlyUpdateItemLockVersion": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItemLockVersion(
                            transactionEntry.taskItem,
                            transactionEntry.taskItem.updateLockVersion,
                        ),
                    );
                    break;
                }
                default:
                    throw exhaustive(transactionEntry.action);
            }

            // If children counts were updated then we want to commit an extra action with
            // the authoritative child counts so all other clients have the correct
            // children count.
            if (transactionEntry.shouldCommitExtraUpdateChildrenCountAction) {
                extraActions.push({
                    type: "UpdateTask",
                    // For our extra action's time, add a tick to the max action time.
                    time: [maxActionTime[0], maxActionTime[1] + 1],
                    taskId: transactionEntry.taskItem.taskId,
                    taskAction: {
                        type: "UpdateChildrenCounts",
                        addedChildTaskCount: transactionEntry.taskItem.addedChildTaskCount,
                        removedChildTaskCount: transactionEntry.taskItem.removedChildTaskCount,
                        addedClosedChildTaskCount:
                            transactionEntry.taskItem.addedClosedChildTaskCount,
                        removedClosedChildTaskCount:
                            transactionEntry.taskItem.removedClosedChildTaskCount,
                    },
                });
            }
        }

        for (const [collectionId, transactionEntry] of this._transactionEntryByCollectionId) {
            switch (transactionEntry.action) {
                case "CreateItem": {
                    transactionEntries.push(
                        TaskTable.transactionCreateItem(transactionEntry.collectionItem),
                    );
                    break;
                }
                case "DirectlyUpdateItem": {
                    transactionEntries.push(
                        TaskTable.transactionDirectlyUpdateItem(transactionEntry.collectionItem),
                    );
                    break;
                }
                case "AtomicallyUpdateItemAttributes": {
                    const updateExpression =
                        taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression +
                        (transactionEntry.lastTaskAddedTime
                            ? ", lastTaskAddedTime = :lastTaskAddedTime"
                            : "");

                    const expressionAttributeValues: {[key: string]: SchemaSerializedValue} = {
                        ":zero": 0,
                        ":one": 1,
                        ":taskCountDelta": transactionEntry.taskCountDelta,
                        ":openTaskCountDelta": transactionEntry.openTaskCountDelta,
                    };

                    if (transactionEntry.lastTaskAddedTime) {
                        expressionAttributeValues[":lastTaskAddedTime"] =
                            HybridLogicalTimeSchema.serialize(transactionEntry.lastTaskAddedTime);
                    }

                    transactionEntries.push(
                        // We use a custom atomic update expression to update our collection without:
                        //
                        // 1. Needing to read the current collection item (costing additional RCUs)
                        // 2. Creating condition expression conflicts with other updates on the task
                        //    collection
                        TaskTable.dangerousTransactionUpdateItemWithCustomUpdateExpression(
                            {
                                partitionType: "TaskCollection",
                                sortRangeType: "EssentialAttributes",
                                collectionId,
                            },
                            {
                                updateExpression,
                                expressionAttributeValues,
                            },
                        ),
                    );
                    break;
                }
                default:
                    throw exhaustive(transactionEntry);
            }
        }

        for (const transactionEntry of extraTransactionEntries ?? []) {
            transactionEntries.push(transactionEntry);
        }

        for (const transactionEntry of this._actionTransactionLeaseTransactionEntries) {
            transactionEntries.push(TaskTable.transactionCreateItem(transactionEntry));
        }

        await commitTaskActionTransactionBeforeExecuteTestCheckpoint.waitForTest(
            this._context.actor.getAccountId(),
        );

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: this._spaceId,
            committedTime: new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [...actions, ...extraActions],
            wasProcessed: false,
            actorId: this._context.actor.getAccountId(),
            clientId,
        };

        if (transactionEntries.length > 0) {
            transactionEntries.push(
                TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
            );

            await DynamoTableSchema.executeTransaction(this._context, transactionEntries);
        } else {
            await TaskActionTable.createOrReplaceItem(this._context, actionTransactionItem);
        }

        // Hooray! We've successfully committed the transaction. Now run our after
        // commit actions...
        if (this._afterCommitActions.length > 0) {
            await runAllPromises(this._afterCommitActions.map(action => action(this._context)));
        }

        return {
            actionTransactionItem,
            extraActions,
        };
    }

    /**
     * Fork this commit state object so you can attempt to prepare more actions
     * based on the updates we've already made to the state without affecting the
     * original state's committed data.
     */
    private _fork() {
        const newState = new TaskActionTransactionCommitState(this._context, {
            spaceId: this._spaceId,
            // The forked state does not inherit the lease. It must authorize on its own.
            leaseId: null,
        });
        newState._startTime = this._startTime;

        for (const [taskId, taskItem] of this._taskItemById) {
            newState._taskItemById.set(taskId, taskItem);
        }

        for (const [collectionId, collectionItem] of this._collectionItemById) {
            newState._collectionItemById.set(collectionId, collectionItem);
        }

        return newState;
    }

    public getActorAccountId(): AccountId {
        return this._context.actor.getAccountId();
    }

    public getAccountIfExists(accountId: AccountId): Promise<AccountModel | null> {
        return getAccountIfExists(this._context, this._spaceId, accountId);
    }

    public isAccountMemberOfSpace(accountId: AccountId): Promise<boolean> {
        return isAccountMemberOfSpace(this._context, this._spaceId, accountId);
    }

    /**
     * Clients specify change times for various properties and we use change times
     * to resolve conflicting updates. Clients may specify a change time at any
     * point in the past (maybe they are syncing offline updates) but they may not
     * specify a change time too far in the future.
     *
     * We provide some wiggle room to account for clock skew. It's required that
     * clients use NTP to get a time (through our `/api/time` route implemented in
     * `EdgeService`) that's consistent with other clients instead of relying on
     * the device clock.
     */
    public isTimeReasonable(time: number): boolean {
        return time - this._startTime < 1000 * 60 * 2;
    }

    public getTaskItemIfExists(taskId: TaskId): Promise<TaskEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._taskItemById, taskId, async () => {
            const taskItem = await TaskTable.getItemIfExists(this._context, {
                partitionType: "Task",
                sortRangeType: "EssentialAttributes",
                taskId,
            });
            if (!taskItem) return null;

            if (taskItem.spaceId !== this._spaceId)
                throw new FailedPreconditionError("Space mismatch");

            return taskItem;
        });
    }

    public async getTaskItem(taskId: TaskId): Promise<TaskEssentialAttributesItem> {
        const taskItem = await this.getTaskItemIfExists(taskId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!taskItem) throw new InternalError("Task not found");

        return taskItem;
    }

    public createTaskItem(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "CreateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                throw new FailedPreconditionError("Can’t update a task before it’s created");
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));
    }

    public updateTaskItem(
        taskItem: TaskEssentialAttributesItem,
        {
            shouldCommitExtraUpdateChildrenCountAction = false,
        }: {
            // If set to true then we will add an `UpdateChildrenCount` action to the end
            // of the current transaction before committing.
            shouldCommitExtraUpdateChildrenCountAction?: boolean;
        } = {},
    ) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        transactionEntry.shouldCommitExtraUpdateChildrenCountAction ||=
            shouldCommitExtraUpdateChildrenCountAction;

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
                break;
            case "DirectlyUpdateItemLockVersion":
                transactionEntry.action = "DirectlyUpdateItem";
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));
    }

    public updateTaskItemLockVersion(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItemLockVersion" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
    }

    /**
     * If the action time was more than an hour in the past then we don't set it as
     * the new `lastTaskAddedTime` since it would look like the last update time
     * was skipping backwards since we can't run `max()` in a DynamoDB update
     * expression.
     */
    private _isCollectionLastTaskAddedTimeReasonable(time: HybridLogicalTime) {
        return this._startTime - time[0] < 1000 * 60;
    }

    private _applyCollectionUpdateItemAttributes(
        collectionItem: TaskCollectionEssentialAttributesItem,
        {
            taskCountDelta,
            openTaskCountDelta,
            lastTaskAddedTime,
        }: {
            taskCountDelta: number;
            openTaskCountDelta: number;
            lastTaskAddedTime: HybridLogicalTime | null;
        },
    ): TaskCollectionEssentialAttributesItem {
        return {
            ...collectionItem,
            taskCount: collectionItem.taskCount + taskCountDelta,
            openTaskCount: collectionItem.openTaskCount + openTaskCountDelta,
            lastTaskAddedTime:
                lastTaskAddedTime &&
                this._isCollectionLastTaskAddedTimeReasonable(lastTaskAddedTime)
                    ? lastTaskAddedTime
                    : collectionItem.lastTaskAddedTime,
        };
    }

    public getCollectionItemIfExists(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._collectionItemById, collectionId, async () => {
            let collectionItem = await TaskTable.getItemIfExists(this._context, {
                partitionType: "TaskCollection",
                sortRangeType: "EssentialAttributes",
                collectionId,
            });
            if (!collectionItem) return null;

            if (collectionItem.spaceId !== this._spaceId)
                throw new FailedPreconditionError("Space mismatch");

            // If we have an atomic update transaction entry, we need to apply it when the
            // collection is loaded. Since we can't put an entry in `collectionItemById`
            // when the update is applied.
            const transactionEntry = this._transactionEntryByCollectionId.get(collectionId);
            if (transactionEntry?.action === "AtomicallyUpdateItemAttributes") {
                collectionItem = this._applyCollectionUpdateItemAttributes(
                    collectionItem,
                    transactionEntry,
                );
            }

            return collectionItem;
        });
    }

    public async getCollectionItem(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem> {
        const collectionItem = await this.getCollectionItemIfExists(collectionId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!collectionItem) throw new InternalError("Task collection not found");

        return collectionItem;
    }

    public createCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                collectionItem,
                action: "CreateItem" as const,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "AtomicallyUpdateItemAttributes":
                throw new FailedPreconditionError("Can’t update a collection before it’s created");
            default:
                throw exhaustive(transactionEntry);
        }

        if (transactionEntry.collectionItem.updateLockVersion !== collectionItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.collectionItem = collectionItem;
        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));
    }

    public updateCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                collectionItem,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem": {
                if (
                    transactionEntry.collectionItem.updateLockVersion !==
                    collectionItem.updateLockVersion
                ) {
                    throw new InternalError(
                        "`updateLockVersion` should only change after we commit to the database",
                    );
                }

                transactionEntry.collectionItem = collectionItem;
                break;
            }
            case "AtomicallyUpdateItemAttributes": {
                // We don't need to apply atomic updates here since they should have already
                // been applied when the calling code read the collection from our state.

                this._transactionEntryByCollectionId.set(collectionItem.collectionId, {
                    action: "DirectlyUpdateItem",
                    collectionItem,
                });
                break;
            }
            default:
                throw exhaustive(transactionEntry);
        }

        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));
    }

    public updateCollectionItemAttributes(
        collectionId: TaskCollectionId,
        update: {
            taskCountDelta: number;
            openTaskCountDelta: number;
            lastTaskAddedTime: HybridLogicalTime | null;
        },
    ) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionId,
            () => ({
                action: "AtomicallyUpdateItemAttributes" as const,
                taskCountDelta: 0,
                openTaskCountDelta: 0,
                lastTaskAddedTime: null,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem": {
                transactionEntry.collectionItem = this._applyCollectionUpdateItemAttributes(
                    transactionEntry.collectionItem,
                    update,
                );

                this._collectionItemById.set(
                    collectionId,
                    Promise.resolve(transactionEntry.collectionItem),
                );
                break;
            }
            case "AtomicallyUpdateItemAttributes": {
                transactionEntry.taskCountDelta += update.taskCountDelta;
                transactionEntry.openTaskCountDelta += update.openTaskCountDelta;
                transactionEntry.lastTaskAddedTime =
                    update.lastTaskAddedTime &&
                    this._isCollectionLastTaskAddedTimeReasonable(update.lastTaskAddedTime)
                        ? update.lastTaskAddedTime
                        : transactionEntry.lastTaskAddedTime;

                // If a collection item has been loaded then we need to apply our update to
                // that item.
                const collectionItemPromise = this._collectionItemById.get(collectionId);
                if (collectionItemPromise) {
                    this._collectionItemById.set(
                        collectionId,
                        collectionItemPromise.then(collectionItem =>
                            collectionItem
                                ? this._applyCollectionUpdateItemAttributes(collectionItem, update)
                                : null,
                        ),
                    );
                }
                break;
            }
            default:
                throw exhaustive(transactionEntry);
        }
    }

    public async validateAccessPolicyUpdate(
        oldAccessPolicy: AccessPolicy | null,
        newAccessPolicy: AccessPolicy,
    ) {
        await validateAccessPolicyUpdateForServer(
            this._context,
            this._spaceId,
            oldAccessPolicy,
            newAccessPolicy,
        );
    }

    public async authorizeCollectionAccess(
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        await authorizeTaskCollectionItemAccess(this._context, collectionItem, expectedAccessLevel);
    }

    public async authorizeCollectionAccessAllowingDeletedCollections(
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        await authorizeTaskCollectionItemAccessAllowingDeletedTasks(
            this._context,
            collectionItem,
            expectedAccessLevel,
        );
    }

    public async authorizeTaskItemAccess(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: AccessLevel,
    ) {
        // If we are using a lease and the lease is valid for this task, skip
        // authorization. The lease allows us to take otherwise disallowed actions.
        if (this._leaseId !== null && this._leaseId === taskItem.validLeaseId) return;

        await authorizeTaskItemAccess(this._context, taskItem, expectedAccessLevel, this);
    }

    public async authorizeTaskItemAccessAllowingDeletedTasks(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: AccessLevel,
    ) {
        // If we are using a lease and the lease is valid for this task, skip
        // authorization. The lease allows us to take otherwise disallowed actions.
        if (this._leaseId !== null && this._leaseId === taskItem.validLeaseId) return;

        await authorizeTaskItemAccessAllowingDeletedTasks(
            this._context,
            taskItem,
            expectedAccessLevel,
            this,
        );
    }

    /**
     * Run some code after the action transaction has successfully committed.
     *
     * You can't register after commit actions when creating a lease (an error will
     * be thrown). Since we don't actually commit lease actions until later.
     */
    public registerAfterCommitAction(
        action: (context: ServerSessionActionContext) => Promise<void>,
    ) {
        this._afterCommitActions.push(action);
    }
}

const circularTaskDependencyErrorDisplayMessage = errorDisplayMessage`Can’t move a task to the subtasks of one of its own subtasks. Check your task’s subtasks and try removing the one you want to move your task into.`;

async function actuallyCommitTaskActionTransaction(
    // We intentionally don't pass in `context` since we want all DynamoDB access
    // to go through this `state` object. That way we force reads to go through our
    // local cache.
    state: TaskActionTransactionCommitState,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskAction>,
) {
    for (const action of actionTransaction) {
        // Make sure our action time isn't too far in the future. That would mean
        // future updates all need to use the `ticks` property of `HybridLogicalTime`
        // and couldn't express the update time with a real time.
        if (!state.isTimeReasonable(action.time[0])) {
            throw new InvalidArgumentError("Action time too far in the future");
        }

        switch (action.type) {
            case "UpdateTask": {
                const {taskId, taskAction} = action;

                switch (taskAction.type) {
                    case "Create": {
                        if (taskAction.creatorId !== state.getActorAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a task with yourself as the creator",
                            );
                        }

                        state.createTaskItem({
                            partitionType: "Task",
                            sortRangeType: "EssentialAttributes",
                            taskId,
                            spaceId,
                            // TODO(calebmer, #api): Think about bot "credit". Ideally bots come with an
                            // initiator. The initiator should get partial credit. For example task created
                            // by Caleb (with ChatGPT). Counting steps on documents and tasks should be
                            // similar. "caleb's docs" in search should find docs written by me (with
                            // ChatGPT).
                            creatorId: taskAction.creatorId,
                            createdTime: action.time,
                            deletedTime: null,
                            statusType: new TaskStatusTypeRegister("Open", action.time),
                            parentTaskId: new TaskParentTaskIdRegister(null, action.time),
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            childTaskIds: new Set(),
                            collections: TaskCollectionSet.empty,
                            assigneeId: new TaskAssigneeAccountIdRegister(null, action.time),
                            validLeaseId: null,
                        });
                        break;
                    }
                    case "Undelete": {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (!taskItem.deletedTime) {
                            throw new FailedPreconditionError("Expected task to be deleted");
                        }

                        await state.authorizeTaskItemAccessAllowingDeletedTasks(taskItem, "Edit");

                        if (compareHybridLogicalTimes(action.time, taskItem.deletedTime) <= 0) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        const seenTaskIds = new Set([taskItem.taskId]);
                        let currentParentTaskItem = taskItem;

                        while (currentParentTaskItem.parentTaskId.value !== null) {
                            // We don't allow task circular dependencies which would cause infinite
                            // looping. Deleted tasks break the circular dependency chain. So a circular
                            // dependency may exist involving a deleted task. When we undelete, we need to
                            // make sure it doesn't create a circular dependency.
                            if (seenTaskIds.has(currentParentTaskItem.parentTaskId.value)) {
                                throw new FailedPreconditionError(
                                    "Undeleting task would create a circular dependency",
                                    {
                                        // NOTE(calebmer): Ideally the error message would have a hint. This error case
                                        // seems pretty rare. I'd want to know what the UI of this looks like to write
                                        // an appropriate hint. (e.g. Can you see the old parent task?)
                                        displayMessage: errorDisplayMessage`Undoing task deletion would make the task its own subtask.`,
                                    },
                                );
                            }

                            const nextParentTaskItem = await state.getTaskItem(
                                currentParentTaskItem.parentTaskId.value,
                            );

                            // Deleted tasks do not participate in circular dependencies.
                            if (nextParentTaskItem.deletedTime) break;

                            seenTaskIds.add(nextParentTaskItem.taskId);
                            currentParentTaskItem = nextParentTaskItem;
                        }

                        // Force updates to a root task's subtask tree to be serialized. That way race
                        // conditions can't sneak a circular dependency in.
                        state.updateTaskItemLockVersion(currentParentTaskItem);

                        state.updateTaskItem({
                            ...taskItem,
                            deletedTime: null,
                            // Invalidate any leases on this task now that another user has updated it.
                            validLeaseId: null,
                        });

                        if (taskItem.parentTaskId.value !== null) {
                            // May be cached from authorization...
                            const parentTaskItem = await state.getTaskItem(
                                taskItem.parentTaskId.value,
                            );

                            state.updateTaskItem(
                                {
                                    ...parentTaskItem,
                                    addedChildTaskCount: parentTaskItem.addedChildTaskCount + 1,
                                    addedClosedChildTaskCount:
                                        parentTaskItem.addedClosedChildTaskCount +
                                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                                },
                                {shouldCommitExtraUpdateChildrenCountAction: true},
                            );
                        }

                        for (const {collectionId} of taskItem.collections.getArray()) {
                            state.updateCollectionItemAttributes(collectionId, {
                                taskCountDelta: 1,
                                openTaskCountDelta: taskItem.statusType.value === "Open" ? 1 : 0,
                                lastTaskAddedTime: action.time,
                            });
                        }
                        break;
                    }
                    default: {
                        const initialTaskItem = await state.getTaskItemIfExists(taskId);
                        if (!initialTaskItem) throw new NotFoundError("Task not found");
                        let taskItem = initialTaskItem;

                        await state.authorizeTaskItemAccess(taskItem, "Edit");

                        if (taskItem.deletedTime)
                            throw new FailedPreconditionError("Task was deleted");

                        if (taskItem.validLeaseId !== null) {
                            taskItem = {
                                ...taskItem,
                                // Invalidate any leases on this task now that another user has updated it.
                                validLeaseId: null,
                            };
                            state.updateTaskItem(taskItem);
                        }

                        switch (taskAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(action.time, taskItem.createdTime) <=
                                    0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    deletedTime: action.time,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    // May be cached from authorization...
                                    const parentTaskItem = await state.getTaskItem(
                                        taskItem.parentTaskId.value,
                                    );

                                    state.updateTaskItem(
                                        {
                                            ...parentTaskItem,
                                            removedChildTaskCount:
                                                parentTaskItem.removedChildTaskCount + 1,
                                            removedClosedChildTaskCount:
                                                parentTaskItem.removedClosedChildTaskCount +
                                                (taskItem.statusType.value === "Closed" ? 1 : 0),
                                        },
                                        {shouldCommitExtraUpdateChildrenCountAction: true},
                                    );
                                }

                                for (const {collectionId} of taskItem.collections.getArray()) {
                                    state.updateCollectionItemAttributes(collectionId, {
                                        taskCountDelta: -1,
                                        openTaskCountDelta:
                                            taskItem.statusType.value === "Open" ? -1 : 0,
                                        lastTaskAddedTime: null,
                                    });
                                }
                                break;
                            }
                            case "UpdateParentTaskId": {
                                if (
                                    taskAction.parentPosition &&
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                // We want to prevent the creation of cycles even during race conditions. So we
                                // call `updateTaskItemLockVersion()` on critical parent tasks that can't
                                // update without us knowing about it. We call this method on:
                                //
                                // 1. The root parent task in the new parent task chain
                                // 2. The root parent task in the old parent task chain
                                //
                                // This has the effect of forcing any change to subtask structure under a root
                                // task to be committed serially. If the root task itself is made the subtask
                                // of some other task than that update too must be serialized with changes to
                                // its subtask structure. By serializing updates to subtask structure we can
                                // make sure no circular dependencies are introduced.
                                await runAllPromiseThunks(
                                    // Authorize new parent `TaskId`:
                                    async () => {
                                        if (taskAction.parentTaskId === null) return;

                                        if (taskId === taskAction.parentTaskId) {
                                            throw new FailedPreconditionError(
                                                "Updating task’s `parentTaskId` would create a circular dependency",
                                                {
                                                    displayMessage:
                                                        circularTaskDependencyErrorDisplayMessage,
                                                },
                                            );
                                        }

                                        const newParentTaskItem = await state.getTaskItemIfExists(
                                            taskAction.parentTaskId,
                                        );
                                        if (!newParentTaskItem)
                                            throw new NotFoundError("Parent task not found");
                                        if (newParentTaskItem.deletedTime)
                                            throw new FailedPreconditionError(
                                                "Parent task is deleted",
                                            );

                                        // Make sure we have edit access to the parent task in order to make this task
                                        // a child of it.
                                        await state.authorizeTaskItemAccess(
                                            newParentTaskItem,
                                            "Edit",
                                        );

                                        const seenTaskIds = new Set([
                                            taskId,
                                            newParentTaskItem.taskId,
                                        ]);
                                        let currentNewParentTaskItem = newParentTaskItem;

                                        while (
                                            currentNewParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            // We don't allow task circular dependencies which would cause infinite
                                            // looping. If we see that updating our `parentTaskId` would create a circular
                                            // dependency then error.
                                            if (
                                                seenTaskIds.has(
                                                    currentNewParentTaskItem.parentTaskId.value,
                                                )
                                            ) {
                                                throw new FailedPreconditionError(
                                                    "Updating task’s `parentTaskId` would create a circular dependency",
                                                    {
                                                        displayMessage:
                                                            circularTaskDependencyErrorDisplayMessage,
                                                    },
                                                );
                                            }

                                            // Parent task loading may be cached by our `authorizeTaskItemAccess()`
                                            // call earlier.
                                            const nextNewParentTaskItem = await state.getTaskItem(
                                                currentNewParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextNewParentTaskItem.deletedTime) break;

                                            seenTaskIds.add(nextNewParentTaskItem.taskId);
                                            currentNewParentTaskItem = nextNewParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentNewParentTaskItem);
                                    },
                                    // Authorize old parent `TaskId`:
                                    async () => {
                                        if (taskItem.parentTaskId.value === null) return;

                                        const oldParentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );
                                        if (oldParentTaskItem.deletedTime) return;

                                        // We allow you to change the parent of a task you have edit access to even if
                                        // you don't have access to the _current_ parent task. This is because we also
                                        // allow you to delete tasks even when you don't have access to the current
                                        // parent task. That operation will remove a child task from a parent task so
                                        // it follows a user is allowed to remove tasks they have access to from
                                        // unknown parents.
                                        //
                                        // Should we allow deleting a task when you don't have access to the parent?
                                        // Arguably not. But it's hard to explain a restriction like that in the UI and
                                        // the restriction is not too bad if we explain it in the revision feed.
                                        //
                                        // TODO(calebmer): When we add revision history, deleting or changing the
                                        // parent of a child task should add a revision history entry to the parent
                                        // task. That way a user who has access to the child but not the parent can
                                        // have their changes audited.

                                        let currentOldParentTaskItem = oldParentTaskItem;

                                        while (
                                            currentOldParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            const nextOldParentTaskItem = await state.getTaskItem(
                                                currentOldParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextOldParentTaskItem.deletedTime) break;

                                            currentOldParentTaskItem = nextOldParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentOldParentTaskItem);
                                    },
                                );

                                const oldParentTaskId = taskItem.parentTaskId;
                                const newParentTaskId = oldParentTaskId.apply({
                                    value: taskAction.parentTaskId,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    parentTaskId: newParentTaskId.apply({
                                        value: taskAction.parentTaskId,
                                        version: action.time,
                                    }),
                                });

                                // If the parent task changed then increment our counters such that we remove
                                // our task from the old parent and add our task to the new parent.
                                if (oldParentTaskId.value !== newParentTaskId.value) {
                                    await runAllPromiseThunks(
                                        async () => {
                                            if (oldParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const oldParentTaskItem = await state.getTaskItem(
                                                oldParentTaskId.value,
                                            );

                                            const oldParentChildTaskIds = new Set(
                                                oldParentTaskItem.childTaskIds,
                                            );
                                            oldParentChildTaskIds.delete(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...oldParentTaskItem,
                                                    removedChildTaskCount:
                                                        oldParentTaskItem.removedChildTaskCount + 1,
                                                    removedClosedChildTaskCount:
                                                        oldParentTaskItem.removedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: oldParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                        async () => {
                                            if (newParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const newParentTaskItem = await state.getTaskItem(
                                                newParentTaskId.value,
                                            );

                                            const newParentChildTaskIds = new Set(
                                                newParentTaskItem.childTaskIds,
                                            );
                                            newParentChildTaskIds.add(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...newParentTaskItem,
                                                    addedChildTaskCount:
                                                        newParentTaskItem.addedChildTaskCount + 1,
                                                    addedClosedChildTaskCount:
                                                        newParentTaskItem.addedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: newParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                    );
                                }
                                break;
                            }
                            case "UpdateParentPosition": {
                                if (
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.parentTaskId.value === null) {
                                    throw new FailedPreconditionError("Task doesn’t have a parent");
                                }

                                const parentTaskItem = await state.getTaskItem(
                                    taskItem.parentTaskId.value,
                                );
                                if (parentTaskItem.deletedTime)
                                    throw new FailedPreconditionError("Parent task is deleted");

                                // Make sure we have edit access to the parent task. The order key is more-so a
                                // property of the parent task than it is a property of our task.
                                await state.authorizeTaskItemAccess(parentTaskItem, "Edit");
                                break;
                            }
                            case "UpdateChildrenCounts": {
                                // These actions may only be generated by the server.
                                //
                                // See the documentation on `TaskUpdateChildrenCountsAction` for more
                                // information on why this isn't allowed.
                                throw new InvalidArgumentError(
                                    "Clients are not allowed to commit an `UpdateChildrenCounts` action",
                                );
                            }
                            case "AddCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Set",
                                        key: taskAction.collectionId,
                                        value: taskAction.orderKey,
                                        version: action.time,
                                    }),
                                });

                                state.updateCollectionItemAttributes(taskAction.collectionId, {
                                    taskCountDelta: 1,
                                    openTaskCountDelta:
                                        taskItem.statusType.value === "Open" ? 1 : 0,
                                    lastTaskAddedTime: action.time,
                                });
                                break;
                            }
                            case "RemoveCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Delete",
                                        key: taskAction.collectionId,
                                        version: action.time,
                                    }),
                                });

                                state.updateCollectionItemAttributes(taskAction.collectionId, {
                                    taskCountDelta: -1,
                                    openTaskCountDelta:
                                        taskItem.statusType.value === "Open" ? -1 : 0,
                                    lastTaskAddedTime: null,
                                });
                                break;
                            }
                            case "UpdateCollectionPosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (!taskItem.collections.has(taskAction.collectionId)) {
                                    throw new FailedPreconditionError("Task is not in collection");
                                }

                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );
                                break;
                            }
                            case "UpdateStatus": {
                                if (
                                    taskAction.status.type === "Closed" &&
                                    !state.isTimeReasonable(
                                        taskAction.status.closedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `closedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.status.type === "Closed" &&
                                    taskAction.status.closerId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only close a task with yourself as the closer",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatus?.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                const oldStatusType = taskItem.statusType;

                                const newStatusType = oldStatusType.apply({
                                    value: taskAction.status.type,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    statusType: newStatusType,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                addedClosedChildTaskCount:
                                                    parentTaskItem.addedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                removedClosedChildTaskCount:
                                                    parentTaskItem.removedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }
                                }

                                for (const {collectionId} of taskItem.collections.getArray()) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        state.updateCollectionItemAttributes(collectionId, {
                                            taskCountDelta: 0,
                                            openTaskCountDelta: -1,
                                            lastTaskAddedTime: null,
                                        });
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        state.updateCollectionItemAttributes(collectionId, {
                                            taskCountDelta: 0,
                                            openTaskCountDelta: 1,
                                            lastTaskAddedTime: null,
                                        });
                                    }
                                }
                                break;
                            }
                            case "UpdateAssignee": {
                                if (
                                    taskAction.assignee &&
                                    !state.isTimeReasonable(
                                        taskAction.assignee.assignedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `assignedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    taskAction.assignee.assignerId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only assign a task with yourself as the assigner",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    // We intentionally use `getAccountIfExists()` instead of
                                    // `isAccountMemberOfSpace()` here. If an account is removed from a
                                    // space it should still be ok setting the removed account as a task
                                    // assignee. Though it's probably unwise for a user to do so.
                                    !(await state.getAccountIfExists(
                                        taskAction.assignee.assigneeId,
                                    ))
                                ) {
                                    throw new FailedPreconditionError(
                                        "Can’t assign a task to an account outside of the current space",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatus?.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    assigneeId: taskItem.assigneeId.apply({
                                        value: taskAction.assignee?.assigneeId ?? null,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            case "UpdateAssigneeStatus": {
                                if (
                                    taskAction.assigneeStatus.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdateAssigneePosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.assigneeId.value !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only update the task’s assignee position if you are the task’s assignee",
                                    );
                                }

                                if (taskAction.accountId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Must use the actor `AccountId` when updating the task’s assignee position",
                                    );
                                }
                                break;
                            }
                            case "UpdateTitle": {
                                // Y.js uses Lamport timestamps which we don't need to validate for
                                // reasonableness.
                                break;
                            }
                            case "UpdateDueDate": {
                                // We don't store due date in essential attributes and action time
                                // is validated above.
                                break;
                            }
                            case "UpdatePriority": {
                                // We don't store priority in essential attributes and action time
                                // is validated above.
                                break;
                            }
                            case "UpdateNotepadPagePosition":
                            case "UpdateAssigneeActivePosition": {
                                throw new InvalidArgumentError(
                                    quote`Can’t commit deprecated task action type ${action.taskAction.type}`,
                                );
                            }
                            default:
                                throw exhaustive(taskAction);
                        }
                    }
                }
                break;
            }
            case "UpdateCollection": {
                const {collectionId, collectionAction} = action;

                switch (collectionAction.type) {
                    case "Create": {
                        if (collectionAction.creatorId !== state.getActorAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a collection with yourself as the creator",
                            );
                        }

                        const {creatorId} = collectionAction;

                        const newCollectionItem: TaskCollectionEssentialAttributesItem = {
                            partitionType: "TaskCollection",
                            sortRangeType: "EssentialAttributes",
                            collectionId,
                            spaceId,
                            createdTime: action.time,
                            creatorId,
                            rawDeletedTime: null,
                            rawUndeletedTime: null,
                            name: new LabelStringRegister(collectionAction.name, action.time),
                            color: new TaskCollectionColorRegister(null, action.time),
                            accessPolicy: new AccessPolicyRegister(
                                collectionAction.accessPolicy,
                                action.time,
                            ),
                            hasAddedFeedCandidateEntry:
                                !!collectionAction.accessPolicy.defaultGrant,
                            taskCount: 0,
                            openTaskCount: 0,
                            lastTaskAddedTime: null,
                        };

                        await state.validateAccessPolicyUpdate(
                            null,
                            newCollectionItem.accessPolicy.value,
                        );

                        state.createCollectionItem(newCollectionItem);

                        state.registerAfterCommitAction(async context => {
                            const entry: FeedEntry = {
                                type: "TaskCollection",
                                collectionId,
                                sharedTime: new Date(action.time[0]),
                                sharerId: creatorId,
                                creatorId,
                                event: "Created",
                            };

                            // If we created a public task collection then add a feed candidate entry after
                            // 15 minutes. We wait 15 minutes to give the user the chance to add some tasks
                            // to the collection. So the feed entry we publish doesn't show an empty task
                            // collection.
                            if (newCollectionItem.hasAddedFeedCandidateEntry) {
                                context.jobs.send(
                                    {
                                        type: "AddFeedCandidateEntry",
                                        jobId: generateId(),
                                        spaceId,
                                        entry,
                                    },
                                    {delaySeconds: 15 * 60},
                                );
                            }
                            // If we're creating a private task collection then only add an entry to the
                            // creator account's personal feed.
                            else {
                                context.jobs.send(
                                    {
                                        type: "AddFeedAccountCandidateEntry",
                                        jobId: generateId(),
                                        spaceId,
                                        accountId: creatorId,
                                        entry,
                                    },
                                    {delaySeconds: 15 * 60},
                                );
                            }
                        });
                        break;
                    }
                    case "Undelete": {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw createTaskCollectionNotFoundError(collectionId);
                        if (!isTaskCollectionItemDeleted(collectionItem)) {
                            throw new FailedPreconditionError(
                                "Expected task collection to be deleted",
                            );
                        }

                        // If `isTaskCollectionItemDeleted()` returns true then we have
                        // `rawDeletedTime`.
                        assert(collectionItem.rawDeletedTime);

                        await state.authorizeCollectionAccessAllowingDeletedCollections(
                            collectionId,
                            "Manage",
                        );

                        if (
                            compareHybridLogicalTimes(action.time, collectionItem.rawDeletedTime) <=
                            0
                        ) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        state.updateCollectionItem({
                            ...collectionItem,
                            rawUndeletedTime: action.time,
                        });
                        break;
                    }
                    default: {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw createTaskCollectionNotFoundError(collectionId);
                        if (isTaskCollectionItemDeleted(collectionItem))
                            throw new FailedPreconditionError("Task collection was deleted");

                        switch (collectionAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.createdTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                if (
                                    collectionItem.rawUndeletedTime &&
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.rawUndeletedTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than undelete action time",
                                    );
                                }

                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    rawDeletedTime: action.time,
                                });
                                break;
                            }
                            case "UpdateName": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newName = collectionItem.name.apply({
                                    value: collectionAction.name,
                                    version: action.time,
                                });

                                if (collectionItem.name !== newName) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        name: newName,
                                    });
                                }
                                break;
                            }
                            case "UpdateColor": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newColor = collectionItem.color.apply({
                                    value: collectionAction.color,
                                    version: action.time,
                                });

                                if (collectionItem.color !== newColor) {
                                    state.updateCollectionItem({
                                        ...collectionItem,
                                        color: newColor,
                                    });
                                }
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                const newAccessPolicy = collectionItem.accessPolicy.apply({
                                    value: collectionAction.accessPolicy,
                                    version: action.time,
                                });

                                await state.validateAccessPolicyUpdate(
                                    collectionItem.accessPolicy.value,
                                    newAccessPolicy.value,
                                );

                                const oldHasAddedFeedCandidateEntry =
                                    collectionItem.hasAddedFeedCandidateEntry;
                                const newHasAddedFeedCandidateEntry =
                                    oldHasAddedFeedCandidateEntry ||
                                    !!newAccessPolicy.value.defaultGrant;

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    accessPolicy: newAccessPolicy,
                                    hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                                });

                                // If we're sharing a task collection for the first time then add a feed
                                // candidate entry after 15 minutes. We wait 15 minutes to give the user the
                                // chance to add some tasks to the collection. So the feed entry we publish
                                // doesn't show an empty task collection.
                                //
                                // Unless there are 8 or more open tasks. Then we add the feed candidate entry
                                // immediately since we have enough tasks to render a good preview in feed.
                                if (
                                    newHasAddedFeedCandidateEntry &&
                                    !oldHasAddedFeedCandidateEntry
                                ) {
                                    state.registerAfterCommitAction(async context => {
                                        const entry: FeedEntry = {
                                            type: "TaskCollection",
                                            collectionId,
                                            sharedTime: new Date(action.time[0]),
                                            sharerId: state.getActorAccountId(),
                                            creatorId: collectionItem.creatorId,
                                            event: "SharedWithAccessPolicyDefaultGrant",
                                        };

                                        if (collectionItem.openTaskCount >= 8) {
                                            context.process.waitUntil(async () => {
                                                await addFeedCandidateEntry(
                                                    context,
                                                    spaceId,
                                                    entry,
                                                );
                                            });
                                        } else {
                                            context.jobs.send(
                                                {
                                                    type: "AddFeedCandidateEntry",
                                                    jobId: generateId(),
                                                    spaceId,
                                                    entry,
                                                },
                                                {delaySeconds: 15 * 60},
                                            );
                                        }
                                    });
                                }
                                break;
                            }
                            default:
                                throw exhaustive(collectionAction);
                        }
                        break;
                    }
                }
                break;
            }
            case "UpdateAccountName": {
                // Clients can't commit this action whenever they'd like by calling
                // `commitTaskActionTransaction()`. We only commit this action when updating
                // an account's name.
                throw new InvalidArgumentError(
                    "Clients are not allowed to commit an `UpdateAccountName` action",
                );
            }
            case "UpdateNotepadPage": {
                throw new InvalidArgumentError(
                    quote`Can’t commit deprecated action type ${action.type}`,
                );
            }
            default:
                throw exhaustive(action);
        }
    }
}

export const deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Delete the provided `TaskId` and all children of that task in a single
 * transaction. Returns the actions we committed from this function call.
 *
 * On the client we may not know all the transitive children of a task. So this
 * functionality needs to be implemented on the server.
 */
export function deleteTaskAndAllChildren(
    context: ServerSessionActionContext,
    taskId: TaskId,
    actionTime: HybridLogicalTime,
    options?: {clientId?: TaskRealtimeClientId},
): Promise<{
    spaceId: SpaceId;
    actions: ReadonlyArray<TaskAction>;
}> {
    let hasAlreadyAttempted = false;

    return context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        const taskItem = await TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });

        await authorizeTaskItemAccess(context, taskItem, "Edit", {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null),
        });

        let rootParentTaskItem: TaskEssentialAttributesItem = taskItem;
        let parentTaskItem: TaskEssentialAttributesItem | null = null;
        while (rootParentTaskItem.parentTaskId.value) {
            const parentTaskId = rootParentTaskItem.parentTaskId.value;

            rootParentTaskItem =
                (isInitialAttempt
                    ? await TaskItemAuthorizationCache.getIfExists(
                          context,
                          "Eventual",
                          parentTaskId,
                      )
                    : null) ??
                (await TaskTable.getItem(context, {
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId: parentTaskId,
                }));

            // We want to keep track of both the root parent task and the first
            // parent task.
            if (parentTaskItem === null) {
                parentTaskItem = rootParentTaskItem;
            }
        }

        const seenTaskIds = new Set([taskItem.taskId]);
        const updatedTaskItems: Array<{
            oldTaskItem: TaskEssentialAttributesItem;
            newTaskItem: TaskEssentialAttributesItem;
        }> = [];

        const updatedCollectionById = new Map<
            TaskCollectionId,
            {taskCountDelta: number; openTaskCountDelta: number}
        >();

        // Note that child tasks inherit the parent task's authorization.
        const addTaskItem = async (taskItem: TaskEssentialAttributesItem) => {
            const childTaskCount = taskItem.childTaskIds.size;
            let closedChildTaskCount = 0;

            await runAllPromises(
                Array.from(taskItem.childTaskIds, async childTaskId => {
                    const childTaskItem = await TaskTable.getItem(context, {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId: childTaskId,
                    });

                    if (childTaskItem.statusType.value === "Closed") {
                        closedChildTaskCount++;
                    }

                    // Keep track of `seenTaskIds` since while child tasks child be an acyclic tree
                    // where each node is unique, there may be concurrent task updates which cause
                    // us to observe something different.
                    if (seenTaskIds.has(childTaskItem.taskId)) return;

                    await addTaskItem(childTaskItem);
                }),
            );

            updatedTaskItems.push({
                oldTaskItem: taskItem,
                newTaskItem: {
                    ...taskItem,
                    deletedTime: actionTime,
                    removedChildTaskCount: taskItem.removedChildTaskCount + childTaskCount,
                    removedClosedChildTaskCount:
                        taskItem.removedClosedChildTaskCount + closedChildTaskCount,
                    // Invalidate any leases on this task now that another user has updated it.
                    validLeaseId: null,
                },
            });

            for (const {collectionId} of taskItem.collections.getArray()) {
                const updatedCollection = getOrSetDefaultMapValue(
                    updatedCollectionById,
                    collectionId,
                    () => ({taskCountDelta: 0, openTaskCountDelta: 0}),
                );

                updatedCollection.taskCountDelta -= 1;

                if (taskItem.statusType.value !== "Closed") {
                    updatedCollection.openTaskCountDelta -= 1;
                }
            }
        };

        await addTaskItem(taskItem);

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        // Whenever we update a task's parent, we increment the `updateLockVersion` of
        // the root parent task. This way we can force updates to the child tree
        // structure to happen in sequence so we can validate there are no cycles.
        //
        // Force our recursive task deletion to be a part of this update sequence.
        if (
            rootParentTaskItem.taskId !== taskItem.taskId &&
            // We'll update `parentTaskItem` below so if it's the same as
            // `rootParentTaskItem` then we don't need to update `rootParentTaskItem`.
            rootParentTaskItem.taskId !== parentTaskItem?.taskId
        ) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItemLockVersion(
                    rootParentTaskItem,
                    rootParentTaskItem.updateLockVersion,
                ),
            );
        }

        if (parentTaskItem) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItem({
                    ...parentTaskItem,
                    addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                    removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                    addedClosedChildTaskCount: parentTaskItem.addedClosedChildTaskCount,
                    removedClosedChildTaskCount:
                        parentTaskItem.removedClosedChildTaskCount +
                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                }),
            );
        }

        for (const {newTaskItem} of updatedTaskItems) {
            transactionEntries.push(TaskTable.transactionDirectlyUpdateItem(newTaskItem));
        }

        for (const [collectionId, updatedCollection] of updatedCollectionById) {
            transactionEntries.push(
                TaskTable.dangerousTransactionUpdateItemWithCustomUpdateExpression(
                    {
                        partitionType: "TaskCollection",
                        sortRangeType: "EssentialAttributes",
                        collectionId,
                    },
                    {
                        updateExpression:
                            taskCollectionAtomicallyUpdateItemTaskCountAttributesExpression,
                        expressionAttributeValues: {
                            ":zero": 0,
                            ":one": 1,
                            ":taskCountDelta": updatedCollection.taskCountDelta,
                            ":openTaskCountDelta": updatedCollection.openTaskCountDelta,
                        },
                    },
                ),
            );
        }

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: taskItem.spaceId,
            committedTime: new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                ...updatedTaskItems.map(
                    ({newTaskItem}): TaskAction => ({
                        type: "UpdateTask",
                        time: actionTime,
                        taskId: newTaskItem.taskId,
                        taskAction: {type: "Delete"},
                    }),
                ),
                ...filterMapArray(
                    updatedTaskItems,
                    ({oldTaskItem, newTaskItem}): TaskAction | undefined => {
                        const countKeys = [
                            "addedChildTaskCount",
                            "removedChildTaskCount",
                            "addedClosedChildTaskCount",
                            "removedClosedChildTaskCount",
                        ] as const;

                        const oldTaskCounts = pickObject(oldTaskItem, countKeys);
                        const newTaskCounts = pickObject(newTaskItem, countKeys);

                        if (isDeepEqual(oldTaskCounts, newTaskCounts)) return;

                        return {
                            type: "UpdateTask",
                            // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above
                            // the action time.
                            time: [actionTime[0], actionTime[1] + 1],
                            taskId: newTaskItem.taskId,
                            taskAction: {
                                type: "UpdateChildrenCounts",
                                ...newTaskCounts,
                            },
                        };
                    },
                ),
                ...(parentTaskItem
                    ? cast<Array<TaskAction>>([
                          {
                              type: "UpdateTask",
                              // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above
                              // the action time.
                              time: [actionTime[0], actionTime[1] + 1],
                              taskId: parentTaskItem.taskId,
                              taskAction: {
                                  type: "UpdateChildrenCounts",
                                  addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                                  removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                                  addedClosedChildTaskCount:
                                      parentTaskItem.addedClosedChildTaskCount,
                                  removedClosedChildTaskCount:
                                      parentTaskItem.removedClosedChildTaskCount +
                                      (taskItem.statusType.value === "Closed" ? 1 : 0),
                              },
                          },
                      ])
                    : []),
            ],
            wasProcessed: false,
            actorId: context.actor.getAccountId(),
            clientId: options?.clientId ?? null,
        };

        transactionEntries.push(
            TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
        );

        await deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        await afterCommitTaskActionTransaction(context, actionTransactionItem);

        return {
            spaceId: actionTransactionItem.spaceId,
            actions: actionTransactionItem.actions,
        };
    });
}

/**
 * Duplicate the provided `TaskId` and all children of that task in a single
 * transaction. Returns the actions we committed from this function call.
 *
 * On the client we may not know all the transitive children of a task. So this
 * functionality needs to be implemented on the server.
 */
export function duplicateTaskAndAllChildren(
    context: ServerSessionActionContext,
    taskId: TaskId,
    actionTime: HybridLogicalTime,
    timeZone: TimeZone,
): Promise<{
    spaceId: SpaceId;
    actions: ReadonlyArray<TaskAction>;
    taskId: TaskId;
}> {
    return context.dynamo.retryTransaction(async context => {
        const taskItem = await TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });

        await authorizeTaskItemAccess(context, taskItem, "Edit", {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null),
        });

        const taskDisplayStatusFilter = {
            ifOpenActive: true,
            ifOpenInactive: true,
            ifClosed: true,
        } as const;

        let newRootTaskId: TaskId | null = null;

        const createNotesClone = (
            existingNotesItem: TaskNotesItem,
            newTaskId: TaskId,
        ): TaskNotesItem => ({
            partitionType: "Task",
            sortRangeType: "Notes",
            taskId: newTaskId,
            spaceId: existingNotesItem.spaceId,
            content: existingNotesItem.content,
            // Reset version tracking
            stepCountByAccountId: new TaskStepCountByAccountId(new Map()),
            version: 0,
        });

        // Our dynamo transaction limit is 100 actions. If we exceed that, we'll throw an error.
        // We don't want to keep resolving children if we already know we're going to fail.
        // For now, we just track the total child task count and throw if we exceed it.
        const maxClonedObjectCount = 100;
        let totalClonedObjectCount = 1;

        /**
         * Aggregates all actions for a task and its children.
         *
         * @param currentTaskId The ID of the current task.
         * @param parentTaskId The ID of the parent task.
         * @returns
         */
        const aggregateRecursiveActions = async (currentTaskId: TaskId, parentTaskId?: TaskId) => {
            const loadQueriesPromise = context.tasks.loadQueries(taskItem.spaceId, {
                taskIds: [currentTaskId],
                collectionIds: [],
                queries: [
                    {
                        // Only request as many as we can support (+1 to allow hitting our limit)
                        limit: maxClonedObjectCount - totalClonedObjectCount + 1,
                        filters: {
                            displayStatusFilter: taskDisplayStatusFilter,
                            parentFilter: {
                                parentTaskId: currentTaskId,
                            },
                        },
                        sorts: [],
                    },
                ],
            });

            const loadNotesPromise = TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Notes",
                taskId: currentTaskId,
            });

            const [queryResult, notesItem] = await runAllPromises([
                loadQueriesPromise,
                loadNotesPromise,
            ]);

            const currentTask = assertExists(
                findMapIterable(queryResult.updateEvent.backfillTasks, backfillTask =>
                    backfillTask.type === "Authorized" && backfillTask.task.id === currentTaskId
                        ? backfillTask.task
                        : undefined,
                ),
            );

            const {taskId: newCurrentTaskId, actions: newActions} = currentTask.getDuplicateActions(
                {
                    creatorId: context.actor.getAccountId(),
                    actionTime,
                    creatorTimeZone: timeZone,
                    titleSuffix: !parentTaskId ? "copy" : undefined,
                    parentTaskId,
                },
            );

            if (!parentTaskId) {
                newRootTaskId = newCurrentTaskId;
            }

            const actions = [...newActions];
            const extraTransactionEntries: Array<DynamoTransactionEntry> = [];
            const clonedTaskIds = new Map<TaskId, TaskId>([[currentTaskId, newCurrentTaskId]]);

            if (notesItem) {
                totalClonedObjectCount++;
                const newNotesItem = createNotesClone(notesItem, newCurrentTaskId);
                extraTransactionEntries.push(
                    TaskTable.transactionCreateOrReplaceItem(newNotesItem),
                );
            }

            await runAllPromises(
                queryResult.updateEvent.backfillTasks.map(async childTask => {
                    if (childTask.type !== "Authorized") return;
                    if (childTask.task.getParent()?.taskId !== currentTaskId) return;

                    // There’s an edge case / race condition where we could produce a cycle. If so,
                    // just ignore the child task and break the cycle.
                    // There is an incredibly small chance where  we would try to fetch the same
                    // task multiple times AFTER this check. We don't handle that here.
                    if (clonedTaskIds.has(childTask.task.id)) {
                        return;
                    }

                    if (childTask.task.getChildTaskCount() > 0) {
                        // Recurse for the child tasks
                        const childTaskActions = await aggregateRecursiveActions(
                            childTask.task.id,
                            newCurrentTaskId,
                        );

                        actions.push(...childTaskActions.actions);
                        extraTransactionEntries.push(...childTaskActions.extraTransactionEntries);

                        for (const [
                            oldChildTaskId,
                            newChildTaskId,
                        ] of childTaskActions.clonedTaskIds) {
                            clonedTaskIds.set(oldChildTaskId, newChildTaskId);
                        }

                        totalClonedObjectCount += childTaskActions.clonedTaskIds.size;
                    } else {
                        // No child tasks, just clone the task
                        const {taskId: newChildTaskId, actions: newActions} =
                            childTask.task.getDuplicateActions({
                                creatorId: context.actor.getAccountId(),
                                actionTime,
                                creatorTimeZone: timeZone,
                                parentTaskId: newCurrentTaskId,
                            });

                        actions.push(...newActions);
                        clonedTaskIds.set(childTask.task.id, newChildTaskId);
                        totalClonedObjectCount++;

                        // since we aren't recursing here, just grab the notes for this task
                        const childTaskNotesItem = await TaskTable.getItemIfExists(context, {
                            partitionType: "Task",
                            sortRangeType: "Notes",
                            taskId: childTask.task.id,
                        });

                        if (childTaskNotesItem) {
                            totalClonedObjectCount++;
                            const newChildTaskNotesItem = createNotesClone(
                                childTaskNotesItem,
                                newChildTaskId,
                            );

                            extraTransactionEntries.push(
                                TaskTable.transactionCreateOrReplaceItem(newChildTaskNotesItem),
                            );
                        }
                    }

                    if (totalClonedObjectCount > 100) {
                        throw new FailedPreconditionError("Child task limit exceeded", {
                            displayMessage: errorDisplayMessage`The task has too many child tasks.`,
                            // dedupe against the original root task ID
                            aggregateDedupeKey: taskId,
                        });
                    }
                }),
            );

            return {
                actions,
                clonedTaskIds,
                extraTransactionEntries,
            };
        };

        const {actions, extraTransactionEntries} = await aggregateRecursiveActions(taskId);
        assertExists(newRootTaskId);
        const returnedTaskId = newRootTaskId!;

        await commitTaskActionTransaction(context, taskItem.spaceId, actions, {
            extraTransactionEntries,
        });

        return {
            taskId: returnedTaskId,
            actions,
            spaceId: taskItem.spaceId,
        };
    });
}

/**
 * The task part required for implementing `updateOurAccountName()`.
 * Commits an `UpdateAccountName` action to every space the account is in then
 * once the transaction has committed begins indexing the action.
 */
export function internalGetUpdateOurAccountNameTaskTransactionEntries(
    context: ServerSessionActionContext,
    {
        spaceIds,
        name,
        nameVersion,
    }: {
        spaceIds: ReadonlySet<SpaceId>;
        name: string;
        nameVersion: number;
    },
): Array<DynamoTransactionEntry> {
    const currentTime = new Date();

    const actionTransactionItems = Array.from(spaceIds, spaceId => {
        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId,
            committedTime: currentTime,
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                {
                    type: "UpdateAccountName",
                    time: [currentTime.getTime(), 0],
                    accountId: context.actor.getAccountId(),
                    accountName: name,
                    accountNameVersion: nameVersion,
                },
            ],
            wasProcessed: false,
            actorId: context.actor.getAccountId(),
            clientId: null,
        };

        return actionTransactionItem;
    });

    return actionTransactionItems.map(actionTransactionItem =>
        TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem, {
            onAfterTransactionExecutedSuccessfully: async () => {
                await afterCommitTaskActionTransaction(context, actionTransactionItem);
            },
        }),
    );
}

export const backfillTaskActionTransactionHistoryTestCounter = new TestCounter<SpaceId>();

/**
 * Get all action transactions since the provided start time in the
 * provided space.
 */
export async function backfillTaskActionTransactionHistory(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    startCommittedTime: Date,
): Promise<
    Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }>
> {
    // Must have system access since we return all actions. We don't
    // filter out actions the current session doesn't have access to.
    context.actor.authorizeSystem();

    await authorizeSpaceAccess(context, spaceId);

    const actionTransactions: Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }> = [];

    backfillTaskActionTransactionHistoryTestCounter.incrementForTest(spaceId);

    for await (const item of TaskActionTable.query(context, {
        partitionKey: {
            partitionType: "TaskActions",
            spaceId,
        },
        startSortKey: {
            sortRangeType: "ActionTransaction",
            committedTime: startCommittedTime,
            actionTransactionId: getMinId<TaskActionTransactionId>(),
        },
        limit: "All",
        consistency: "Strong",
    })) {
        actionTransactions.push({
            spaceId: item.spaceId,
            committedTime: item.committedTime,
            actions: item.actions,
        });
    }

    return actionTransactions;
}

const TaskItemAuthorizationCache = new DynamoContextCache<
    TaskId,
    TaskEssentialAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Gets a task to be used in authorization. If used in `TaskRealtimeService`
 * then you may provide a loader function to use an in-memory task
 * representation.
 *
 * 1. Attempts to get an in-memory task representation when used in
 *    `TaskRealtimeService` with `getTaskIndexDocIfExists`.
 *
 * 2. Otherwise loads the task from the database (cached within the action
 *    context).
 *
 * We force `getTaskIndexDocIfExists` to be synchronous. If you don't have the
 * task in memory then we should load from DynamoDB, not OpenSearch.
 */
async function getTaskItemForAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    taskId: TaskId,
    loaders: {getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined} | null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<TaskEssentialAttributesItemBase> {
    const taskItem = await getTaskItemForAuthorizationIfExists(context, taskId, loaders, options);
    if (!taskItem) throw createTaskNotFoundError(taskId);
    return taskItem;
}

async function getTaskItemForAuthorizationIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    taskId: TaskId,
    loaders: {getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined} | null,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<TaskEssentialAttributesItemBase | null> {
    const taskIndexDoc = loaders?.getTaskIndexDocIfExists(taskId);
    if (taskIndexDoc) return convertTaskIndexDocToItem(taskIndexDoc);

    const taskItem = await TaskItemAuthorizationCache.get(
        context,
        consistency,
        taskId,
        consistency =>
            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId,
                },
                {consistency},
            ),
    );

    return taskItem;
}

const TaskCollectionItemAuthorizationCache = new DynamoContextCache<
    TaskCollectionId,
    TaskCollectionEssentialAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Gets a collection to be used in authorization. If used in
 * `TaskRealtimeService` then you may provide a loader function to use an
 * in-memory collection representation.
 *
 * 1. Attempts to get an in-memory collection representation when used in
 *    `TaskRealtimeService` with `getCollectionIndexDocIfExists`.
 *
 * 2. Otherwise loads the collection from the database (cached within the
 *    action context).
 *
 * We force `getCollectionIndexDocIfExists` to be synchronous. If you don't
 * have the collection in memory then we should load from DynamoDB, not
 * OpenSearch.
 */
async function getTaskCollectionItemForAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    collectionId: TaskCollectionId,
    loaders: {
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<TaskCollectionEssentialAttributesItemBase> {
    const collectionItem = await getTaskCollectionItemForAuthorizationIfExists(
        context,
        collectionId,
        loaders,
        options,
    );
    if (!collectionItem) throw createTaskCollectionNotFoundError(collectionId);
    return collectionItem;
}

async function getTaskCollectionItemForAuthorizationIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    collectionId: TaskCollectionId,
    loaders: {
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<TaskCollectionEssentialAttributesItemBase | null> {
    const collectionIndexDoc = loaders?.getCollectionIndexDocIfExists(collectionId);
    if (collectionIndexDoc) return convertTaskCollectionIndexDocToItem(collectionIndexDoc);

    return TaskCollectionItemAuthorizationCache.get(
        context,
        consistency,
        collectionId,
        async consistency =>
            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "TaskCollection",
                    sortRangeType: "EssentialAttributes",
                    collectionId,
                },
                {consistency},
            ),
    );
}

async function authorizeTaskCollectionItemAccess(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
): Promise<void> {
    unwrapResult(
        await authorizeTaskCollectionItemAccessIfPossible(
            context,
            collectionItem,
            expectedAccessLevel,
        ),
    );
}

async function authorizeTaskCollectionItemAccessAllowingDeletedTasks(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
): Promise<void> {
    unwrapResult(
        await authorizeTaskCollectionItemAccessAllowingDeletedTasksIfPossible(
            context,
            collectionItem,
            expectedAccessLevel,
        ),
    );
}

async function authorizeTaskCollectionItemAccessIfPossible(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    const result = await authorizeTaskCollectionItemAccessAllowingDeletedTasksIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
        options,
    );

    // If you were authorized to view, edit, whatever, but the collection is
    // deleted then you don't have edit access anymore but you can still view the
    // collection.
    if (result.ok && isTaskCollectionItemDeleted(collectionItem)) {
        let isMemberOfSpace = false;

        switch (context.actor.type) {
            case "System": {
                isMemberOfSpace = true;
                break;
            }
            case "Anonymous": {
                isMemberOfSpace = false;
                break;
            }
            case "Session":
            case "ImpersonatedAccount":
            case "Bot": {
                isMemberOfSpace = await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    collectionItem.spaceId,
                    context.actor.getPossiblyBotAccountId(),
                );
                break;
            }
            default:
                throw exhaustive(context.actor);
        }

        if (!isMemberOfSpace) {
            return {
                ok: false,
                error: new PermissionDeniedError(
                    "Only space members may read deleted task collections",
                    {displayMessage: errorDisplayMessage`Task collection was deleted.`},
                ),
            };
        }

        if (!hasAccessLevel("View", expectedAccessLevel)) {
            return {
                ok: false,
                error: new PermissionDeniedError(
                    quote`Can only view deleted task collection, access level ${expectedAccessLevel} is not allowed`,
                    {displayMessage: errorDisplayMessage`Task collection was deleted.`},
                ),
            };
        }
    }

    return result;
}

async function authorizeTaskCollectionItemAccessAllowingDeletedTasksIfPossible(
    context: TaskRealtimeActionContext,
    collectionItem: TaskCollectionEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        collectionItem.spaceId,
        collectionItem.accessPolicy.value,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: collectionItem.spaceId,
            expectedAccessLevel,
            aggregateDedupeKey: collectionItem.collectionId,
            displayMessages: taskCollectionPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}

/**
 * Tests if the context's actor is allowed to access the provided collection
 * with the provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
export async function authorizeTaskCollectionAccess(
    context: TaskRealtimeActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
): Promise<{spaceId: SpaceId}> {
    const collectionItem = await getTaskCollectionItemForAuthorization(
        context,
        collectionId,
        loaders,
    );

    await authorizeTaskCollectionItemAccess(context, collectionItem, expectedAccessLevel);

    return {spaceId: collectionItem.spaceId};
}

/**
 * Tests if the context's actor is allowed to access the provided collection
 * with the provided access level. Returns an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
export async function authorizeTaskCollectionAccessIfPossible(
    context: TaskRealtimeActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId}, ErrorBase> | null> {
    const collectionItem = await getTaskCollectionItemForAuthorizationIfExists(
        context,
        collectionId,
        loaders,
        options,
    );
    if (!collectionItem) return null;

    const result = await authorizeTaskCollectionItemAccessIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
        options,
    );
    if (!result.ok) return result;

    return {ok: true, value: {spaceId: collectionItem.spaceId}};
}

/**
 * Can the provided account access the provided collection index doc? Returns
 * false if not.
 *
 * Be careful when using this function! You are expected to provide index docs
 * from an up-to-date source. You should not directly load from OpenSearch
 * since OpenSearch is at least 30 seconds behind at all times. This function
 * is only really safely useful in `TaskRealtimeService` which maintains
 * `TaskCollectionIndexDoc`s up-to-date in-memory.
 *
 * If you use this function you are taking on your own authorization
 * responsibilities. Like properly stopping data from being sent to the client
 * when this function returns false.
 */
export function authorizeTaskCollectionIndexDocAccessIfPossible(
    context: TaskRealtimeActionContext,
    collectionIndexDoc: TaskCollectionIndexDoc,
    expectedAccessLevel: AccessLevel,
): Promise<Result<void, ErrorBase>> {
    return authorizeTaskCollectionItemAccessIfPossible(
        context,
        convertTaskCollectionIndexDocToItem(collectionIndexDoc),
        expectedAccessLevel,
    );
}

/**
 * Tests if the context's actor is allowed to access the provided task with the
 * provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
export async function authorizeTaskAccess(
    context: TaskRealtimeActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; createdTime: HybridLogicalTime}> {
    const taskItem = await getTaskItemForAuthorization(context, taskId, loaders, options);

    unwrapResult(
        await authorizeTaskItemAccessIfPossible(
            context,
            taskItem,
            expectedAccessLevel,
            {
                getTaskItem: taskId =>
                    getTaskItemForAuthorization(context, taskId, loaders, options),
                getCollectionItem: collectionId =>
                    getTaskCollectionItemForAuthorization(context, collectionId, loaders, options),
            },
            options,
        ),
    );

    return {spaceId: taskItem.spaceId, createdTime: taskItem.createdTime};
}

/**
 * Tests if the context's actor is allowed to access the provided task with the
 * provided access level. Returns an error result if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
export async function authorizeTaskAccessIfPossible(
    context: TaskRealtimeActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<{spaceId: SpaceId; createdTime: HybridLogicalTime}, ErrorBase> | null> {
    const taskItem = await getTaskItemForAuthorizationIfExists(context, taskId, loaders, options);
    if (!taskItem) return null;

    const result = await authorizeTaskItemAccessIfPossible(
        context,
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, loaders, options),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, loaders, options),
        },
        options,
    );
    if (!result.ok) return result;

    return {ok: true, value: {spaceId: taskItem.spaceId, createdTime: taskItem.createdTime}};
}

/**
 * Tests if the context's actor is allowed to access the provided task item
 * with the provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
async function authorizeTaskItemAccess(
    context: ServerActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    unwrapResult(
        await authorizeTaskItemAccessIfPossible(
            context,
            taskItem,
            expectedAccessLevel,
            loaders,
            options,
        ),
    );
}

async function authorizeTaskItemAccessAllowingDeletedTasks(
    context: ServerActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
): Promise<void> {
    unwrapResult(
        await authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
            context,
            taskItem,
            expectedAccessLevel,
            loaders,
        ),
    );
}

async function authorizeTaskItemAccessIfPossible(
    context: TaskRealtimeActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    const result = await authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
        context,
        taskItem,
        expectedAccessLevel,
        loaders,
        options,
    );

    // If you were authorized to view, edit, whatever, but the task is deleted then
    // you don't have edit access anymore but you can still view the task.
    if (result.ok && taskItem.deletedTime) {
        let isMemberOfSpace = false;

        switch (context.actor.type) {
            case "System": {
                isMemberOfSpace = true;
                break;
            }
            case "Anonymous": {
                isMemberOfSpace = false;
                break;
            }
            case "Session":
            case "ImpersonatedAccount": {
                isMemberOfSpace = await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    taskItem.spaceId,
                    context.actor.getAccountId(),
                );
                break;
            }
            case "Bot": {
                return {
                    ok: false,
                    error: new PermissionDeniedError("Bot can’t access deleted tasks", {
                        displayMessage: errorDisplayMessage`Task was deleted.`,
                    }),
                };
            }
            default:
                throw exhaustive(context.actor);
        }

        if (!isMemberOfSpace) {
            return {
                ok: false,
                error: new PermissionDeniedError("Only space members may read deleted tasks", {
                    displayMessage: errorDisplayMessage`Task was deleted.`,
                }),
            };
        }

        if (!hasAccessLevel("View", expectedAccessLevel)) {
            return {
                ok: false,
                error: new PermissionDeniedError(
                    quote`Can only view deleted task, access level ${expectedAccessLevel} is not allowed`,
                    {displayMessage: errorDisplayMessage`Task was deleted.`},
                ),
            };
        }
    }

    return result;
}

async function authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
    context: TaskRealtimeActionContext,
    taskItem: TaskEssentialAttributesItemBase,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<TaskEssentialAttributesItemBase>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItemBase>;
    },
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    switch (context.actor.type) {
        case "System": {
            if (context.actor.getSpaceId() !== taskItem.spaceId) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "System actor doesn’t have access to task’s space",
                    ),
                };
            }

            return okResult;
        }

        case "Session":
        case "ImpersonatedAccount":
        case "Anonymous": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== taskItem.spaceId
            ) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "Impersonated account actor doesn’t have access to task’s space",
                    ),
                };
            }

            const actorAccountId =
                context.actor.type !== "Anonymous" ? context.actor.getPossiblyBotAccountId() : null;

            if (actorAccountId !== null) {
                // The task creator has edit access level on their own task.
                if (
                    actorAccountId === taskItem.creatorId &&
                    hasAccessLevel("Edit", expectedAccessLevel) &&
                    (await isAccountMemberOfSpaceWithoutAuthorization(
                        context,
                        taskItem.spaceId,
                        actorAccountId,
                    ))
                ) {
                    return okResult;
                }

                // The task assignee has edit access level on their own task.
                if (
                    taskItem.assigneeId.value &&
                    actorAccountId === taskItem.assigneeId.value &&
                    hasAccessLevel("Edit", expectedAccessLevel) &&
                    (await isAccountMemberOfSpaceWithoutAuthorization(
                        context,
                        taskItem.spaceId,
                        actorAccountId,
                    ))
                ) {
                    return okResult;
                }
            }

            // An array of `TaskCollectionId`s that authorize access to the task or `null`
            // if no `TaskCollectionId`s authorize access to the task.
            const authorizingCollectionItems = await runAllPromises(
                taskItem.collections.getArray().map(async ({collectionId}) => {
                    const collectionItem = await loaders.getCollectionItem(collectionId);

                    // Deleted collections don't grant any access.
                    if (isTaskCollectionItemDeleted(collectionItem)) return null;

                    const hasAccess = await evaluateAccessPolicy(
                        context,
                        collectionItem.spaceId,
                        collectionItem.accessPolicy.value,
                        expectedAccessLevel,
                        options,
                    );

                    return hasAccess ? collectionItem : null;
                }),
            );

            // We evaluate the access policies for all collections on a task but we only
            // need one passing access policy.
            if (authorizingCollectionItems.some(isNonNullable)) return okResult;

            if (taskItem.parentTaskId.value) {
                const parentTaskItem = await loaders.getTaskItem(taskItem.parentTaskId.value);

                // Parent tasks implicitly grant access to all of their child tasks. If we have
                // a parent task that is not deleted then check it before throwing a permission
                // denied error.
                if (!parentTaskItem.deletedTime) {
                    return authorizeTaskItemAccessAllowingDeletedTasksIfPossible(
                        context,
                        parentTaskItem,
                        expectedAccessLevel,
                        loaders,
                        options,
                    );
                }
            }

            return {
                ok: false,
                error: await createAccessPolicyPermissionDeniedError(context, {
                    spaceId: taskItem.spaceId,
                    expectedAccessLevel,
                    aggregateDedupeKey: taskItem.taskId,
                    displayMessages: taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
                }),
            };
        }

        // NOTE(calebmer): When authorizing whether a `Bot` has access to a task, we
        // need to collect everyone who has access to the task together at once and
        // compare that against the bot's scope.
        //
        // Unlike authorization for a `Session` actor where we take a more optimized
        // approach looking through each piece of a task one-by-one and only loading
        // the next referenced task/collection if we haven't authorized earlier.
        case "Bot": {
            // Optimization: Before we go and load the task's full access policy, see if we
            // can authorize task access using just the information immediately available
            // in the task. The task's creator and assignee.
            //
            // Useful if a user is in a personal chat and asking their bot to read their
            // personal tasks.
            const cheapAccessPolicy: AccessPolicyWithoutGenerations = {
                accountGrantById: new Map([
                    [taskItem.creatorId, {level: "Edit"}],
                    ...(taskItem.assigneeId.value
                        ? [[taskItem.assigneeId.value, {level: "Edit"}] as const]
                        : []),
                ]),
                defaultGrant: null,
                urlGrant: null,
            };

            if (
                await evaluateAccessPolicy(
                    context,
                    taskItem.spaceId,
                    cheapAccessPolicy,
                    expectedAccessLevel,
                    options,
                )
            ) {
                return okResult;
            }

            const accessPolicy = await getTaskItemAccessPolicyWithoutAuthorization(
                context,
                taskItem,
                options,
            );

            if (
                await evaluateAccessPolicy(
                    context,
                    taskItem.spaceId,
                    accessPolicy,
                    expectedAccessLevel,
                    options,
                )
            ) {
                return okResult;
            }

            return {
                ok: false,
                error: await createAccessPolicyPermissionDeniedError(context, {
                    spaceId: taskItem.spaceId,
                    expectedAccessLevel,
                    aggregateDedupeKey: taskItem.taskId,
                    displayMessages: taskPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
                }),
            };
        }

        default:
            throw exhaustive(context.actor);
    }
}

async function authorizeTaskAccessAndGetCommentsSummaryItem(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    item: TaskEssentialAttributesItem;
    commentsSummaryItem: TaskCommentsSummaryItem | null;
}> {
    let taskItem: TaskEssentialAttributesItem | null = null;
    let taskCommentsSummaryItem: TaskCommentsSummaryItem | null = null;

    const taskItemPromise = (async () => {
        for await (const item of TaskTable.query(context, {
            partitionKey: {
                partitionType: "Task",
                taskId,
            },
            startSortKey: {
                sortRangeType: "EssentialAttributes",
            },
            endSortKey: {
                sortRangeType: "CommentsSummary",
            },
            limit: "All",
            consistency,
        })) {
            if (item.sortRangeType === "EssentialAttributes") {
                taskItem = item;
            } else if (item.sortRangeType === "CommentsSummary") {
                taskCommentsSummaryItem = item;
            }
        }

        return taskItem;
    })();

    // Cache the `taskItem` in case `getTaskItemForAuthorization()` is called for
    // the same `TaskId` later.
    TaskItemAuthorizationCache.set(context, consistency, taskId, taskItemPromise);

    taskItem = await taskItemPromise;
    if (!taskItem) throw createTaskNotFoundError(taskId);

    await authorizeTaskItemAccess(
        context,
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId =>
                getTaskItemForAuthorization(context, taskId, null, {consistency}),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null, {consistency}),
        },
        {consistency},
    );

    return {
        item: taskItem,
        commentsSummaryItem: taskCommentsSummaryItem,
    };
}

async function authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists<Value>(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    process: (options: {
        item: TaskEssentialAttributesItem;
        commentsSummaryItem: TaskCommentsSummaryItem | null;
        notesItem: TaskNotesItem | null;
    }) => Promise<Value>,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Value | null> {
    let item: TaskEssentialAttributesItem | null = null;
    let commentsSummaryItem: TaskCommentsSummaryItem | null = null;
    let notesItem: TaskNotesItem | null = null;

    const itemPromise = (async () => {
        for await (const currentItem of TaskTable.query(context, {
            partitionKey: {
                partitionType: "Task",
                taskId,
            },
            startSortKey: {
                sortRangeType: "EssentialAttributes",
            },
            endSortKey: {
                sortRangeType: "Notes",
            },
            limit: "All",
            consistency,
        })) {
            if (currentItem.sortRangeType === "EssentialAttributes") {
                item = currentItem;
            } else if (currentItem.sortRangeType === "CommentsSummary") {
                commentsSummaryItem = currentItem;
            } else if (currentItem.sortRangeType === "Notes") {
                notesItem = currentItem;
            }
        }

        return item;
    })();

    // Cache the `taskItem` in case `getTaskItemForAuthorization()` is called for
    // the same `TaskId` later.
    TaskItemAuthorizationCache.set(context, consistency, taskId, itemPromise);

    item = await itemPromise;
    if (!item) return null;

    const [, value] = await runAllPromises([
        authorizeTaskItemAccess(
            context,
            item,
            expectedAccessLevel,
            {
                getTaskItem: taskId =>
                    getTaskItemForAuthorization(context, taskId, null, {consistency}),
                getCollectionItem: collectionId =>
                    getTaskCollectionItemForAuthorization(context, collectionId, null, {
                        consistency,
                    }),
            },
            {consistency},
        ),
        process({
            item,
            commentsSummaryItem,
            notesItem,
        }),
    ]);

    return value;
}

async function authorizeTaskAccessAndGetCommentsSummaryAndNotesItems<Value>(
    context: ServerActionContext,
    taskId: TaskId,
    expectedAccessLevel: AccessLevel,
    process: (options: {
        item: TaskEssentialAttributesItem;
        commentsSummaryItem: TaskCommentsSummaryItem | null;
        notesItem: TaskNotesItem | null;
    }) => Promise<Value>,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Value> {
    const value = await authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists(
        context,
        taskId,
        expectedAccessLevel,
        process,
        options,
    );

    if (!value) throw createTaskNotFoundError(taskId);
    return value;
}

/**
 * Load the task's access policy for a bot scoped to the task. Used
 * when evaluating whether a bot has permissions to certain resources.
 *
 * We grant access to the task based on:
 *
 * - The task's creator
 * - The task's assignee
 * - The task's collections
 * - The task's parent task (recursively)
 */
export async function getTaskAccessPolicyForBotScope(
    context: ServerMinimalBotActionContext,
    taskId: TaskId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicyWithoutGenerations> {
    const scope = context.actor.getScope();
    if (scope.type !== "Task" || scope.taskId !== taskId) {
        throw new PermissionDeniedError("Can only get access policy for the scoped task");
    }

    const taskItem = await getTaskItemForAuthorization(context, taskId, null, options);

    const [, accessPolicy] = await runAllPromises([
        authorizeSpaceAccess(context, taskItem.spaceId),
        getTaskItemAccessPolicyWithoutAuthorization(context, taskItem, options),
    ]);

    return accessPolicy;
}

async function getTaskItemAccessPolicyWithoutAuthorization(
    context: ServerMinimalActionContext,
    rootTaskItem: TaskEssentialAttributesItemBase,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicyWithoutGenerations> {
    const accountGrantById = new Map<AccountId, {level: AccessLevel}>();
    let defaultGrant: {level: AccessLevel} | null = null;
    let urlGrant: {level: "View"} | null = null;

    const seenCollectionIds = new Set<TaskCollectionId>();
    const seenTaskIds = new Set<TaskId>([rootTaskItem.taskId]);

    function addAccountGrant(accountId: AccountId, accessLevel: AccessLevel) {
        let accountGrant = accountGrantById.get(accountId);
        if (accountGrant === undefined) {
            accountGrant = {level: accessLevel};
            accountGrantById.set(accountId, accountGrant);
        } else {
            accountGrant.level = maxAccessLevel(accountGrant.level, accessLevel);
        }
    }

    function addDefaultGrant(accessLevel: AccessLevel) {
        if (defaultGrant === null) {
            defaultGrant = {level: accessLevel};
        } else {
            defaultGrant.level = maxAccessLevel(defaultGrant.level, accessLevel);
        }
    }

    function addUrlGrant(accessLevel: "View") {
        if (urlGrant === null) {
            urlGrant = {level: "View"};
        } else {
            // The only acceptable access level right now is `View`.
            cast<"View">(accessLevel);
        }
    }

    const addTaskGrants = async (taskItem: TaskEssentialAttributesItemBase) => {
        addAccountGrant(taskItem.creatorId, "Edit");

        if (taskItem.assigneeId.value) {
            addAccountGrant(taskItem.assigneeId.value, "Edit");
        }

        await runAllPromises([
            (async () => {
                if (!taskItem.parentTaskId.value) return;

                if (seenTaskIds.has(taskItem.parentTaskId.value)) return;
                seenTaskIds.add(taskItem.parentTaskId.value);

                const parentTaskItem = await getTaskItemForAuthorization(
                    context,
                    taskItem.parentTaskId.value,
                    null,
                    options,
                );

                if (parentTaskItem.deletedTime) return;

                await addTaskGrants(parentTaskItem);
            })(),
            runAllPromises(
                taskItem.collections.getArray().map(async ({collectionId}) => {
                    if (seenCollectionIds.has(collectionId)) return;
                    seenCollectionIds.add(collectionId);

                    const collectionItem = await getTaskCollectionItemForAuthorization(
                        context,
                        collectionId,
                        null,
                        options,
                    );

                    if (isTaskCollectionItemDeleted(collectionItem)) return;

                    const accessPolicy = collectionItem.accessPolicy.value;

                    for (const [accountId, accountGrant] of accessPolicy.accountGrantById) {
                        addAccountGrant(accountId, accountGrant.level);
                    }

                    if (accessPolicy.defaultGrant) {
                        addDefaultGrant(accessPolicy.defaultGrant.level);
                    }

                    if (accessPolicy.urlGrant) {
                        addUrlGrant(accessPolicy.urlGrant.level);
                    }
                }),
            ),
        ]);
    };

    await addTaskGrants(rootTaskItem);

    return {
        accountGrantById,
        defaultGrant,
        urlGrant,
    };
}

async function getTaskCommentItemIfExists(
    context: ServerActionContext,
    taskId: TaskId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        processCommentsQuery(
            "Ascending",
            TaskTable.query(context, {
                limit: "All",
                consistency,
                partitionKey: {
                    partitionType: "Task",
                    taskId,
                },
                startSortKey: {
                    sortRangeType: "Comments",
                    commentIndex,
                },
                endSortKey: {
                    sortRangeType: "Comments#StreamPart",
                    commentIndex,
                    partIndex: Number.MAX_SAFE_INTEGER,
                },
            }),
        ),
    );

    assert(items.length <= 1);

    return items[0] ?? null;
}

export async function getTaskComment(
    context: ServerActionContext,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<TaskCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "Comment"),
        getTaskCommentItemIfExists(context, taskId, commentIndex),
    ]);

    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);

    return createTaskCommentModelFromItem(context, spaceId, taskId, item);
}

export async function getTaskCommentPayload(
    context: ServerActionContext,
    {
        taskId,
        commentIndex,
        consistency = "Eventual",
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<MessageItem & {spaceId: SpaceId}> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),
        getTaskCommentItemIfExists(context, taskId, commentIndex, {consistency}),
    ]);

    if (!item) throw createTaskCommentNotFoundError(taskId, commentIndex);

    return {spaceId, ...item};
}

async function createTaskCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
    item: MessageItem,
): Promise<TaskCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileTaskAuthorizer.bind({type: "TaskComments", taskId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new TaskCommentModel({
        taskId,
        index: item.index,
        author,
        createdTime: item.createdTime,
        payload,
        stream: item.stream,
    });
}

/**
 * This enables us to get the current owner of the Task. Since Tasks can
 * constantly be re-assigned we return the current Assignee or the
 * original Task creator.
 */
export async function getTaskOwnerIfPossible(
    context: ServerActionContext,
    taskId: TaskId,
): Promise<Result<AccountModel, ErrorBase>> {
    const taskItem = await getTaskItemForAuthorization(context, taskId, null);

    const result = await authorizeTaskItemAccessIfPossible(context, taskItem, "View", {
        getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
        getCollectionItem: collectionId =>
            getTaskCollectionItemForAuthorization(context, collectionId, null),
    });
    if (!result.ok) return result;

    const owner = taskItem.assigneeId.value
        ? await getAccount(context, taskItem.spaceId, taskItem.assigneeId.value)
        : await getAccount(context, taskItem.spaceId, taskItem.creatorId);

    return {ok: true, value: owner};
}

export async function getTaskNotificationSubscribers(
    context: ServerSystemActionContext,
    id: TaskId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    accountIds: ReadonlySet<AccountId>;
}> {
    const {item: taskItem, commentsSummaryItem} =
        await authorizeTaskAccessAndGetCommentsSummaryItem(context, id, "Comment", options);

    const commentCountByAuthorId = commentsSummaryItem
        ? commentsSummaryItem.commentCountByAuthorId.keys()
        : [];
    const mentionCountByAccountId = commentsSummaryItem
        ? commentsSummaryItem.mentionCountByAccountId.keys()
        : [];

    const assigneeId = taskItem.assigneeId?.value;

    // note(maximchen, 2024-07-24): It is an open design question whether a old assignee
    // should stay subscribed to notifications even after they have been unassigned.
    const accountIds = new Set(
        concatIterables(
            [taskItem.creatorId],
            assigneeId ? [assigneeId] : [],
            commentCountByAuthorId,
            mentionCountByAccountId,
        ),
    );

    return {
        accountIds,
    };
}

export function updateTaskCommentContent(
    context: ServerAccountActionContext,
    {
        taskId,
        commentIndex,
        content,
    }: {
        taskId: TaskId;
        commentIndex: number;
        content: MessageContent;
    },
): Promise<{
    spaceId: SpaceId;
    contentUpdatedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{item, commentsSummaryItem}, taskCommentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Comments",
                taskId,
                commentIndex,
            }),
        ]);
        if (!commentsSummaryItem) throw new NotFoundError("Task comments summary item not found");
        if (!taskCommentItem) throw new NotFoundError("Task comment not found");

        if (taskCommentItem.authorId !== context.actor.getPossiblyBotAccountId()) {
            throw new PermissionDeniedError("Can only update Task comments you authored");
        }

        if (taskCommentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        if (taskCommentItem.payload.clerical)
            throw new FailedPreconditionError("Can’t update clerical comment content");

        const contentUpdatedTime = new Date(
            Math.max(
                (commentsSummaryItem.lastChangeTime ?? new Date(item.createdTime[0])).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `contentUpdatedTime`.
        assert(
            !taskCommentItem.payload.contentUpdatedTime ||
                contentUpdatedTime > taskCommentItem.payload.contentUpdatedTime,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem.mentionCountByAccountId,
            taskCommentItem.payload.content,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            TaskTable.transactionDirectlyUpdateItem({
                ...taskCommentItem,
                payload: {
                    ...taskCommentItem.payload,
                    content,
                    contentUpdatedTime,
                },
            }),
            TaskTable.transactionDirectlyUpdateItem({
                ...commentsSummaryItem,
                taskId,
                nextCommentIndex: commentsSummaryItem.nextCommentIndex,
                lastChangeTime: contentUpdatedTime,
                commentCountByAuthorId: commentsSummaryItem.commentCountByAuthorId,
                mentionCountByAccountId: newMentionCountByAccountId,
                updateLockVersion: commentsSummaryItem.updateLockVersion,
            }),
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "CommentChangeLog",
                taskId,
                changeTime: contentUpdatedTime,
                commentIndex: taskCommentItem.commentIndex,
                change: {
                    type: "UpdateContent",
                    content,
                },
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(contentUpdatedTime),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: item.spaceId,
            update: {
                type: "TaskComment",
                taskId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {spaceId: item.spaceId, contentUpdatedTime};
    });
}

export function deleteTaskComment(
    context: ServerAccountActionContext,
    {taskId, commentIndex}: {taskId: TaskId; commentIndex: number},
): Promise<{deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [{item, commentsSummaryItem}, taskCommentItem] = await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment"),
            TaskTable.getItemIfExists(context, {
                partitionType: "Task",
                sortRangeType: "Comments",
                taskId,
                commentIndex,
            }),
        ]);
        if (!commentsSummaryItem) throw new NotFoundError("Task comments summary item not found");
        if (!taskCommentItem) throw new NotFoundError("Task comment not found");

        if (taskCommentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete task comments you authored");

        if (taskCommentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can’t delete comments with a non-content payload");

        if (taskCommentItem.payload.clerical)
            throw new FailedPreconditionError("Can’t delete clerical comments");

        const deletedTime = new Date(
            Math.max(
                (commentsSummaryItem.lastChangeTime ?? new Date(item.createdTime[0])).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `deletedTime`.
        assert(
            !taskCommentItem.payload.contentUpdatedTime ||
                deletedTime > taskCommentItem.payload.contentUpdatedTime,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem.mentionCountByAccountId,
            taskCommentItem.payload.content,
            null,
        );

        await DynamoTableSchema.executeTransaction(context, [
            TaskTable.transactionDirectlyUpdateItem({
                ...taskCommentItem,
                payload: {type: "Deleted", deletedTime},
            }),
            TaskTable.transactionDirectlyUpdateItem({
                ...commentsSummaryItem,
                taskId,
                nextCommentIndex: commentsSummaryItem.nextCommentIndex,
                lastChangeTime: deletedTime,
                commentCountByAuthorId: commentsSummaryItem.commentCountByAuthorId,
                mentionCountByAccountId: newMentionCountByAccountId,
                updateLockVersion: commentsSummaryItem.updateLockVersion,
            }),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "CommentChangeLog",
                taskId,
                changeTime: deletedTime,
                commentIndex: taskCommentItem.commentIndex,
                change: {type: "Delete"},
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(deletedTime),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: item.spaceId,
            update: {
                type: "TaskComment",
                taskId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {deletedTime};
    });
}

export async function createTaskComment(
    context: ServerAccountActionContext,
    {
        taskId,
        parentCommentIndex,
        content,
        fileIds,
        isStream,
        consistency,
    }: {
        taskId: TaskId;
        parentCommentIndex: number | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        isStream?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId, commentsSummaryItem}] = await runAllPromiseThunks(
            async () => {
                const {item, commentsSummaryItem} =
                    await authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment", {
                        consistency,
                    });
                const spaceId = item.spaceId;

                // Make sure all the provided files exist.
                await runAllPromises(
                    fileIds.map(fileId =>
                        isId<FileId>(fileId)
                            ? getFileFromAttachment(
                                  context,
                                  spaceId,
                                  fileId,
                                  FileTaskAuthorizer.bind({type: "TaskComments", taskId}),
                                  {consistency},
                              )
                            : null,
                    ),
                );

                return {spaceId, commentsSummaryItem};
            },
            async () => {
                if (typeof parentCommentIndex !== "number") return;

                const parentCommentItem = await TaskTable.getPartialItemIfExists(
                    context,
                    {
                        partitionType: "Task",
                        sortRangeType: "Comments",
                        taskId,
                        commentIndex: parentCommentIndex,
                    },
                    {
                        consistency,
                        attributes: [],
                    },
                );
                if (!parentCommentItem) throw new NotFoundError("Task parent comment not found");
            },
        );

        const commentIndex = commentsSummaryItem?.nextCommentIndex ?? 0;
        const createdTime = new Date();
        const authorId = context.actor.getPossiblyBotAccountId();

        if (isStream && context.actor.type !== "Bot") {
            throw new PermissionDeniedError("Only bots can send `Stream` messages");
        }

        const newCommentCountByAuthorId = new Map(commentsSummaryItem?.commentCountByAuthorId);
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentsSummaryItem?.mentionCountByAccountId ?? new Map(),
            null,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            TaskTable.transactionCreateItem({
                partitionType: "Task",
                sortRangeType: "Comments",
                taskId,
                commentIndex,
                authorId,
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: parentCommentIndex,
                    content,
                    contentUpdatedTime: null,
                    fileIds,
                    clerical: isStream ? {type: "Stream"} : undefined,
                },
            }),
            commentsSummaryItem !== null
                ? TaskTable.transactionDirectlyUpdateItem({
                      ...commentsSummaryItem,
                      nextCommentIndex: commentsSummaryItem.nextCommentIndex + 1,
                      lastChangeTime: commentsSummaryItem.lastChangeTime,
                      commentCountByAuthorId: newCommentCountByAuthorId,
                      mentionCountByAccountId: newMentionCountByAccountId,
                      updateLockVersion: commentsSummaryItem.updateLockVersion,
                  })
                : TaskTable.transactionCreateItem({
                      partitionType: "Task",
                      sortRangeType: "CommentsSummary",
                      taskId,
                      nextCommentIndex: commentIndex + 1,
                      lastChangeTime: null,
                      commentCountByAuthorId: newCommentCountByAuthorId,
                      mentionCountByAccountId: newMentionCountByAccountId,
                  }),

            // If this is a stream comment then create the stream state item.
            // Create-or-replace is safe since we know the comment index doesn't exist from
            // our other condition checks.
            ...(isStream
                ? [
                      TaskTable.transactionCreateOrReplaceItem({
                          partitionType: "Task",
                          sortRangeType: "Comments#Stream",
                          taskId,
                          commentIndex,
                          authorId,
                          completedTime: null,
                          partCount: 0,
                          lastPartUpdateLockVersion: null,
                          lastIndexSearchEntityJob: {
                              sendTime: createdTime,
                              delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
                          },
                      }),
                  ]
                : []),
        ]);

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);
        const contentSnippet = getNotificationMessageContentSnippet(content);

        context.jobs.send({
            type: "NotificationEvent",
            event: {
                type: "CreateTaskComment",
                id: generateChronologicalId(),
                spaceId: spaceId,
                taskId,
                commentIndex,
                createdTime,
                authorId,
                mentionedAccountIds,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
            },
        });

        context.jobs.send(
            {
                type: "IndexSearchEntity",
                spaceId: spaceId,
                update: {
                    type: "TaskComment",
                    taskId,
                    commentIndex,
                    updatedTraits: {type: "None"},
                },
            },
            {delaySeconds: isStream ? messageStreamIndexSearchEntityDelaySeconds : 0},
        );

        // Only increase affinity score if we have a session actor. Don't increase
        // affinity score if this is a system actor sending a message on behalf of an
        // account.
        if (context.actor.type === "Session") {
            const sessionContext = context.actor.authorizeSession();

            context.process.waitUntil(
                markSearchAffinityEntityInteraction(sessionContext, {
                    spaceId: spaceId,
                    entityId: `Task:${taskId}`,
                    interaction:
                        content.nodeSize < 50
                            ? {type: "LowIntentUpdate"}
                            : {type: "MediumIntentUpdate"},
                }),
            );

            for (const mentionedAccountId of mentionedAccountIds) {
                context.process.waitUntil(async () => {
                    if (await isAccountMemberOfSpace(context, spaceId, mentionedAccountId)) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId: spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });
                    }
                });
            }
        }

        return {
            spaceId,
            index: commentIndex,
            createdTime,
        };
    });
}

/**
 * Update a part of the comment stream.
 *
 * Comment streams are made up of multiple parts. Only the bot that created a
 * stream can update the stream. A bot can only create new parts or update the
 * last part of the stream.
 *
 * Currently, you completely replace a part when you update it. We may allow
 * more granular part updates in the future.
 */
export function putTaskCommentStreamPart(
    context: ServerBotActionContext,
    {
        taskId,
        commentIndex,
        partIndex,
        payload,
        consistency,
    }: {
        taskId: TaskId;
        commentIndex: number;
        partIndex: number;
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),

            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "Comments#Stream",
                    taskId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        if (item.authorId !== context.actor.getBotAccountId()) {
            throw new PermissionDeniedError("Only the bot who created the stream can update it", {
                displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
            });
        }

        if (item.completedTime !== null) {
            throw new FailedPreconditionError("The stream has already been completed", {
                displayMessage: errorDisplayMessage`The stream has already been completed.`,
            });
        }

        // Use `Date.now()` so tests can mock the `Date.now()` function.
        const currentTime = new Date(Date.now());

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        if (
            isDatePossiblyLessThanWithUncertaintyWindow(
                addSeconds(
                    item.lastIndexSearchEntityJob.sendTime,
                    item.lastIndexSearchEntityJob.delaySeconds,
                ),
                currentTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        let version: number;

        if (partIndex === item.partCount) {
            const createPartTransactionEntry = TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex,
                payload,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                TaskTable.transactionDirectlyUpdateItem({
                    ...item,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                createPartTransactionEntry,
            ]);
        } else {
            if (partIndex !== item.partCount - 1) {
                throw new FailedPreconditionError(
                    "Only the last part of the stream or the next part can be updated",
                    {
                        displayMessage: errorDisplayMessage`Only the last part of the stream (index ${
                            item.partCount - 1
                        }) or the next part (index ${item.partCount}) can be updated.`,
                    },
                );
            }

            assert(item.lastPartUpdateLockVersion !== null);

            const updatePartTransactionEntry = TaskTable.transactionCreateOrReplaceItem({
                partitionType: "Task",
                sortRangeType: "Comments#StreamPart",
                taskId,
                commentIndex,
                partIndex,
                payload,
                updateLockVersion: item.lastPartUpdateLockVersion + 1,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                TaskTable.transactionDirectlyUpdateItem({
                    ...item,
                    lastPartUpdateLockVersion: item.lastPartUpdateLockVersion + 1,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                updatePartTransactionEntry,
            ]);
        }

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "TaskComment",
                        taskId,
                        commentIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        return {spaceId, version};
    });
}

/**
 * Completes a comment stream. After this parts can't be added or updated.
 *
 * This function is idempotent. If the stream is already completed this method
 * does nothing.
 */
export function completeTaskCommentStream(
    context: ServerBotActionContext,
    {
        taskId,
        commentIndex,
        consistency,
    }: {
        taskId: TaskId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    completedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeTaskAccess(context, taskId, "Comment", null, {consistency}),

            TaskTable.getItemIfExists(
                context,
                {
                    partitionType: "Task",
                    sortRangeType: "Comments#Stream",
                    taskId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        if (item.authorId !== context.actor.getBotAccountId()) {
            throw new PermissionDeniedError("Only the bot who created the stream can update it", {
                displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
            });
        }

        // Already completed!
        if (item.completedTime !== null) {
            return {spaceId, completedTime: item.completedTime};
        }

        const completedTime = new Date();

        await TaskTable.directlyUpdateItem(context, {
            ...item,
            completedTime,
        });

        return {spaceId, completedTime};
    });
}

function getTaskCommentCount(commentSummaryItem: TaskCommentsSummaryItem | null | undefined) {
    if (!commentSummaryItem) return 0;

    return reduceIterable(
        commentSummaryItem.commentCountByAuthorId.values(),
        (commentCount, authorCommentCount) => commentCount + authorCommentCount,
        0,
    );
}

export async function getTaskCommentsFromStart(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );

    const [{commentsSummaryItem}, {comments, otherReferencedComments}] = await runAllPromises([
        authorizationPromise,
        getTaskCommentsFromStartAssumingAuthorizedTask(context, {
            taskId,
            getSpaceId: () => authorizationPromise.then(({item}) => item.spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);
    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
        lastCommentChangeTime: commentsSummaryItem?.lastChangeTime ?? null,
    };
}

async function getTaskCommentsFromStartAssumingAuthorizedTask(
    context: ServerActionContext,
    {
        taskId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        taskId: TaskId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const commentItems = await arrayFromAsyncIterable(
        processCommentsQuery(
            "Ascending",
            TaskTable.query(context, {
                limit: "All",
                consistency,
                partitionKey: {
                    partitionType: "Task",
                    taskId,
                },
                startSortKey: {
                    sortRangeType: "Comments",
                    commentIndex: queryStartCommentIndex,
                },
                endSortKey: {
                    sortRangeType: "Comments#StreamPart",
                    commentIndex: queryEndCommentIndex,
                    partIndex: Number.MAX_SAFE_INTEGER,
                },
            }),
        ),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<TaskCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getTaskCommentItemIfExists(context, taskId, commentIndex, {
                    consistency,
                });
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createTaskCommentModelFromItem(context, spaceId, taskId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }

            // Don't propagate `consistency` when loading model references. We
            // accept references can have eventual consistency.
            return createTaskCommentModelFromItem(context, spaceId, taskId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

export async function getTaskCommentPayloadsFromStart(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const [{item: taskItem, commentsSummaryItem}, commentItems] = await runAllPromises([
        authorizeTaskAccessAndGetCommentsSummaryItem(context, taskId, "Comment", {consistency}),
        arrayFromAsyncIterable(
            processCommentsQuery(
                "Ascending",
                TaskTable.query(context, {
                    limit: "All",
                    consistency,
                    partitionKey: {
                        partitionType: "Task",
                        taskId,
                    },
                    startSortKey: {
                        sortRangeType: "Comments",
                        commentIndex: queryStartCommentIndex,
                    },
                    endSortKey: {
                        sortRangeType: "Comments#StreamPart",
                        commentIndex: queryEndCommentIndex,
                        partIndex: Number.MAX_SAFE_INTEGER,
                    },
                }),
            ),
        ),
    ]);

    const lastCommentIndex =
        commentItems.length > 0 ? commentItems[commentItems.length - 1]!.index : -1;

    return {
        spaceId: taskItem.spaceId,
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments: commentItems,
    };
}

/**
 * Efficiently load a task's notes and initial comments at the same time.
 *
 * If the actor doesn't have comment access to the task then `initialComments`
 * will be null. We'll still return the task's notes though. Hence when the
 * function name says "optional" initial comments.
 */
export async function getTaskNotesContentAndOptionalInitialComments(
    context: ServerActionContext,
    {taskId, commentsLimit}: {taskId: TaskId; commentsLimit: number},
): Promise<{
    notes: {
        version: number;
        content: TaskNotesContentWithReferences;
    };
    initialComments: {
        commentCount: number;
        comments: ReadonlyArray<TaskCommentModel>;
        otherReferencedComments: ReadonlyArray<TaskCommentModel>;
        lastCommentChangeTime: Date | null;
    } | null;
}> {
    const authorizationPromiseResolver = createPromiseResolver<{
        item: {spaceId: SpaceId};
        commentsSummaryItem: TaskCommentsSummaryItem | null;
    }>();

    const [{item, notes, commentsSummaryItem}, {comments, otherReferencedComments}] =
        await runAllPromises([
            authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
                context,
                taskId,
                "View",
                async result => {
                    const {item, notesItem, commentsSummaryItem} = result;

                    authorizationPromiseResolver.resolve(result);

                    return {
                        item,
                        notes: {
                            version: notesItem?.version ?? 0,
                            content: {
                                doc: notesItem?.content ?? emptyTaskNotesContent,
                                references:
                                    await getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
                                        context,
                                        item.spaceId,
                                        FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                                        notesItem?.content ?? emptyTaskNotesContent,
                                        // Preload small files so we don't have to show a placeholder for them. This
                                        // improves UX at the cost slowing the initial load. Right now we preload
                                        // <100kb files up to 400kb. We'll have to tune this to find the right balance
                                        // between UX and the performance hit.
                                        {withPreloadedFiles: true},
                                    ),
                            },
                        },
                        commentsSummaryItem,
                    };
                },
            ).finally(() => {
                // Make sure the promise resolver doesn't hang forever waiting for a `SpaceId`
                // in failure scenarios.
                if (!authorizationPromiseResolver.isSettled()) {
                    authorizationPromiseResolver.reject(new NotFoundError("Space not found"));
                }
            }),
            getTaskCommentsFromEndAssumingAuthorizedTask(context, {
                taskId,
                authorizationPromise: authorizationPromiseResolver.promise,
                limit: commentsLimit,
                afterCommentIndex: null,
                beforeCommentIndex: null,
            }),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    const commentAuthorizationResult = await authorizeTaskItemAccessIfPossible(
        context,
        item,
        "Comment",
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, null),
        },
    );

    return {
        notes,

        // Only return the comments we fetched if the session actor has access to
        // comments. Otherwise we return null. A little wasteful since we will have
        // fetched all the comments before deciding to return null. But we expect the
        // code path where `commentAuthorizationResult.ok` is false to be much less
        // common than the code path where we need comments so we're ok being a little
        // wasteful.
        initialComments: commentAuthorizationResult.ok
            ? {
                  commentCount: Math.max(
                      getTaskCommentCount(commentsSummaryItem), // Make sure `commentCount` is consistent with `comments` in case of eventual
                      // consistency race conditions.
                      lastCommentIndex + 1,
                  ),
                  comments,
                  otherReferencedComments,
                  lastCommentChangeTime: commentsSummaryItem?.lastChangeTime ?? null,
              }
            : null,
    };
}

export async function getTaskCommentsFromEnd(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );

    const [{commentsSummaryItem}, {comments, otherReferencedComments}] = await runAllPromises([
        authorizationPromise,
        getTaskCommentsFromEndAssumingAuthorizedTask(context, {
            taskId,
            authorizationPromise,
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem), // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
        lastCommentChangeTime: commentsSummaryItem?.lastChangeTime ?? null,
    };
}

async function getTaskCommentsFromEndAssumingAuthorizedTask(
    context: ServerActionContext,
    {
        taskId,
        authorizationPromise,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        taskId: TaskId;
        authorizationPromise: Promise<{
            item: {spaceId: SpaceId};
            commentsSummaryItem: TaskCommentsSummaryItem | null;
        }>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<TaskCommentModel>;
    otherReferencedComments: Array<TaskCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if there
              // was a message stream then query again with `limit: "All"` and a proper query start
              // index. Instead right now we wait for chat access to authorize before starting our
              // query which is slower than authorizing + querying in parallel.
              getTaskCommentCount((await authorizationPromise).commentsSummaryItem) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const commentItems = await arrayFromAsyncIterable(
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? processCommentsQuery(
                  "Descending",
                  TaskTable.query(context, {
                      limit: "All",
                      // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                      // at the end instead of start.
                      descending: true,
                      partitionKey: {
                          partitionType: "Task",
                          taskId,
                      },
                      startSortKey: {
                          sortRangeType: "Comments",
                          commentIndex: queryStartCommentIndex,
                      },
                      endSortKey: {
                          sortRangeType: "Comments#StreamPart",
                          commentIndex: queryEndCommentIndex,
                          partIndex: Number.MAX_SAFE_INTEGER,
                      },
                  }),
              )
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const endCommentIndex = commentItems[0]!.index;
    const startCommentIndex = commentItems[commentItems.length - 1]!.index;

    const {spaceId} = (await authorizationPromise).item;

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<TaskCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getTaskCommentItemIfExists(context, taskId, commentIndex);
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createTaskCommentModelFromItem(context, spaceId, taskId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }
            return createTaskCommentModelFromItem(context, spaceId, taskId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    // We queried in descending order so put comments back in the right order.
    comments.reverse();

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

export async function getTaskCommentPayloadsFromEnd(
    context: ServerActionContext,
    {
        taskId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        taskId: TaskId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
        {consistency},
    );

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if there
              // was a message stream then query again with `limit: "All"` and a proper query start
              // index. Instead right now we wait for chat access to authorize before starting our
              // query which is slower than authorizing + querying in parallel.
              getTaskCommentCount((await authorizationPromise).commentsSummaryItem) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const [{item: taskItem, commentsSummaryItem}, commentItems] = await runAllPromises([
        authorizationPromise,
        arrayFromAsyncIterable(
            processCommentsQuery(
                "Descending",
                TaskTable.query(context, {
                    limit: "All",
                    // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                    // at the end instead of start.
                    descending: true,
                    consistency,
                    partitionKey: {
                        partitionType: "Task",
                        taskId,
                    },
                    startSortKey: {
                        sortRangeType: "Comments",
                        commentIndex: queryStartCommentIndex,
                    },
                    endSortKey: {
                        sortRangeType: "Comments#StreamPart",
                        commentIndex: queryEndCommentIndex,
                        partIndex: Number.MAX_SAFE_INTEGER,
                    },
                }),
            ),
        ),
    ]);

    // We queried in descending order so put comments back in the right order.
    commentItems.reverse();

    const lastCommentIndex =
        commentItems.length > 0 ? commentItems[commentItems.length - 1]!.index : -1;

    return {
        spaceId: taskItem.spaceId,
        commentCount: Math.max(
            getTaskCommentCount(commentsSummaryItem),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments: commentItems,
    };
}

export type TaskCommentChangesResult =
    | {
          type: "Available";
          changes: Array<MessageChange>;
      }
    | {
          type: "Unavailable";
      };

export async function backfillTaskComments(
    context: ServerActionContext,
    {
        taskId,
        clientCommentCount,
        clientLastCommentChangeTime,
        newCommentLimit,
    }: {
        taskId: TaskId;
        clientCommentCount: number;
        clientLastCommentChangeTime: Date | null;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    lastCommentChangeTime: Date | null;
    newComments: Array<TaskCommentModel>;
    newOtherReferencedComments: Array<TaskCommentModel>;
    commentChangesResult: TaskCommentChangesResult;
}> {
    const authorizationPromise = authorizeTaskAccessAndGetCommentsSummaryItem(
        context,
        taskId,
        "Comment",
    );
    const [{commentsSummaryItem}, {comments, otherReferencedComments}, commentChangesResult] =
        await runAllPromises([
            authorizationPromise,
            getTaskCommentsFromStartAssumingAuthorizedTask(context, {
                taskId,
                getSpaceId: () => authorizationPromise.then(({item}) => item.spaceId),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
            (async () => {
                const {item, commentsSummaryItem} = await authorizationPromise;
                if (!commentsSummaryItem) return null;

                return queryTaskCommentChangeLogAssumingAuthorizedTask(context, {
                    commentsSummaryItem,
                    spaceId: item.spaceId,
                    createdTime: item.createdTime,
                    lastCommentChangeTime: clientLastCommentChangeTime,
                    // Use a strong read consistency when backfilling. This guarantees the caller
                    // will observe all realtime events before this function call. Realtime events
                    // that happen during the function call may be missed. You should be subscribed
                    // to new realtime events before starting to backfill.
                    consistency: "Strong",
                });
            })(),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    const lastCommentChangeTime =
        commentChangesResult &&
        commentChangesResult.type === "Available" &&
        commentChangesResult.changes.length > 0
            ? getMessageChangeTime(
                  commentChangesResult.changes[commentChangesResult.changes.length - 1]!,
              )
            : null;

    return {
        commentCount: Math.max(
            reduceIterable(
                commentsSummaryItem?.commentCountByAuthorId.values() ?? [],
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        lastCommentChangeTime:
            lastCommentChangeTime &&
            // Make sure `lastCommentChangeTime` is consistent with
            // `commentChangesResult` in case of eventual consistency race conditions.
            (!commentsSummaryItem?.lastChangeTime ||
                lastCommentChangeTime > commentsSummaryItem.lastChangeTime)
                ? lastCommentChangeTime
                : commentsSummaryItem?.lastChangeTime ?? null,
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentChangesResult: commentChangesResult ?? {type: "Available", changes: []},
    };
}

async function queryTaskCommentChangeLogAssumingAuthorizedTask(
    context: ServerActionContext,
    {
        commentsSummaryItem,
        spaceId,
        createdTime,
        lastCommentChangeTime,
        consistency = "Eventual",
    }: {
        commentsSummaryItem: Pick<
            TaskCommentsSummaryItem,
            | "taskId"
            | "lastChangeTime"
            | "nextCommentIndex"
            | "commentCountByAuthorId"
            | "mentionCountByAccountId"
        >;
        spaceId: SpaceId;
        createdTime: HybridLogicalTime;
        lastCommentChangeTime: Date | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<TaskCommentChangesResult> {
    // No changes occurred during the backfill period, there is nothing we need
    // to query.

    if (commentsSummaryItem.lastChangeTime?.getTime() === lastCommentChangeTime?.getTime())
        return {type: "Available", changes: []};

    const lastCommentChangeExpirationTime = getMessageChangeLogExpirationTimeFromChangeTime(
        lastCommentChangeTime ?? new Date(createdTime[0]),
    );

    // If our last change item has expired then other relevant changelog entries
    // may have also expired. The client will need to fully reset its state since
    // we don't have the data necessary to backfill.
    if (
        isDatePossiblyLessThanWithUncertaintyWindow(
            lastCommentChangeExpirationTime,
            // Use `Date.now()` so tests can mock the `Date.now()` function.
            new Date(Date.now()),
        )
    ) {
        return {type: "Unavailable"};
    }

    const changes = await parallelMapAsyncIterableToArray(
        TaskTable.query(context, {
            partitionKey: {
                partitionType: "Task",
                taskId: commentsSummaryItem.taskId,
            },
            startSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: new Date(
                    (lastCommentChangeTime ?? new Date(createdTime[0])).getTime() + 1,
                ),
            },
            endSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: DynamoKeyAttributeSchema.date.maxValue,
            },
            limit: "All",
            consistency,
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.commentIndex,
                        content: {
                            doc: item.change.content,

                            // Don't propagate `consistency` when loading content references. We
                            // accept references can have eventual consistency.
                            references: await getMessageContentReferencesForNode(
                                context,
                                spaceId,
                                item.change.content,
                            ),
                        },
                        contentUpdatedTime: item.changeTime,
                    };
                }
                case "Delete": {
                    return {
                        type: "Delete",
                        index: item.commentIndex,
                        deletedTime: item.changeTime,
                    };
                }
                default:
                    throw exhaustive(item.change);
            }
        },
    );

    return {type: "Available", changes};
}

/**
 * Can the provided account access the provided task index doc? Returns false
 * if not.
 *
 * Be careful when using this function! You are expected to provide index docs
 * from an up-to-date source. You should not directly load from OpenSearch
 * since OpenSearch is at least 30 seconds behind at all times. This function
 * is only really safely useful in `TaskRealtimeService` which maintains
 * `TaskIndexDoc`s up-to-date in-memory.
 *
 * If you use this function you are taking on your own authorization
 * responsibilities. Like properly stopping data from being sent to the client
 * when this function returns false.
 */
export function authorizeTaskIndexDocAccessIfPossible(
    context: TaskRealtimeActionContext,
    taskIndexDoc: TaskIndexDoc,
    expectedAccessLevel: AccessLevel,
    loaders: {
        getTaskIndexDoc: (taskId: TaskId) => Promise<TaskIndexDoc>;
        getCollectionIndexDoc: (taskId: TaskCollectionId) => Promise<TaskCollectionIndexDoc>;
    },
): Promise<Result<void, ErrorBase>> {
    return authorizeTaskItemAccessIfPossible(
        context,
        convertTaskIndexDocToItem(taskIndexDoc),
        expectedAccessLevel,
        {
            getTaskItem: async taskId => {
                const taskIndexDoc = await loaders.getTaskIndexDoc(taskId);
                return convertTaskIndexDocToItem(taskIndexDoc);
            },
            getCollectionItem: async collectionId => {
                const collectionIndexDoc = await loaders.getCollectionIndexDoc(collectionId);
                return convertTaskCollectionIndexDocToItem(collectionIndexDoc);
            },
        },
    );
}

/**
 * Tests if we are allowed to execute a query with the provided filters and
 * sorts. Throws an error if unauthorized. If authorized then that means all
 * tasks in the query are also authorized and we don't need to check each task
 * individually.
 *
 * Consults DynamoDB by default but if you're in `TaskRealtimeService` and have
 * an up-to-date in-memory representation of tasks then you may provide the
 * `getTaskIndexDocIfExists` function and `getCollectionIndexDocIfExists`
 * function to skip making network requests for tasks/collections that exist in
 * memory.
 *
 * Be careful using `getTaskIndexDocIfExists` and
 * `getCollectionIndexDocIfExists`! Data loaded from the OpenSearch task index
 * is at least 30sec behind since that's the refresh interval. Only use those
 * options if you're in `TaskRealtimeService` and have an up-to-date in-memory
 * representation of tasks.
 */
export async function authorizeTaskQueryAccess(
    context: TaskRealtimeActionContext,
    {
        spaceId,
        filters,
        sorts,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
) {
    let hasAccess = false;

    // Account has edit access to all tasks they created. So authorize if we have
    // an exclusive creator filter for our session account.
    if (
        context.actor.type === "Session" &&
        filters.creatorFilter?.accountIds.size === 1 &&
        filters.creatorFilter.type === "OneOf" &&
        filters.creatorFilter.accountIds.has(context.actor.getAccountId()) &&
        // You must be a space member to filter for tasks you created. If you lost
        // access to a space you can't filter for your own tasks anymore.
        (await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            spaceId,
            context.actor.getAccountId(),
        ))
    ) {
        hasAccess = true;
    }

    // Account has edit access to tasks it is assigned to. So authorize if we have
    // an exclusive assignee filter for our session account.
    if (
        context.actor.type === "Session" &&
        filters.assigneeFilter?.accountIds.size === 1 &&
        filters.assigneeFilter.type === "OneOf" &&
        filters.assigneeFilter.accountIds.has(context.actor.getAccountId()) &&
        // You must be a space member to filter for tasks you're assigned. If you lost
        // access to a space you can't filter for your own tasks anymore.
        (await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            spaceId,
            context.actor.getAccountId(),
        ))
    ) {
        hasAccess = true;
    }

    await runAllPromiseThunks(
        async () => {
            if (!filters.collectionsFilter) return;

            await runAllPromises(
                filters.collectionsFilter.map(async clause => {
                    // Make sure we're authorized to view every referenced collection...
                    await runAllPromises(
                        Array.from(clause.keys(), async term => {
                            if (term === "IsEmpty") return;

                            const {spaceId: collectionSpaceId} =
                                await authorizeTaskCollectionAccess(context, term, "View", loaders);

                            if (spaceId !== collectionSpaceId) {
                                throw new PermissionDeniedError(
                                    "Task collection is in the wrong space",
                                );
                            }
                        }),
                    );

                    // For this filter to grant access, we need to guarantee the query only returns
                    // tasks that have at least one collection we can view.
                    //
                    // A normalized collections filter is in [conjunctive normal form][1]. That
                    // means if one of the "AND"ed clauses narrows down to only viewable collections
                    // this filter can grant access. That's what we check here.
                    //
                    // [1]: https://en.wikipedia.org/wiki/Conjunctive_normal_form
                    if (iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not)) {
                        hasAccess = true;
                    }
                }),
            );
        },
        async () => {
            if (!filters.parentFilter) return;

            // View access on the parent task is inherited to child tasks.
            const {spaceId: taskSpaceId} = await authorizeTaskAccess(
                context,
                filters.parentFilter.parentTaskId,
                "View",
                loaders,
            );

            if (spaceId !== taskSpaceId) {
                throw new PermissionDeniedError("Parent task is in the wrong space");
            }

            hasAccess = true;
        },
        async () => {
            // Must have space access to filter by hidden accounts. We only send account
            // information for assignees to actors without space access (e.g. anonymous
            // actors viewing a collection they have access to via `urlGrant`). Allowing an
            // actor without space access to filter by hidden accounts could reveal
            // information we don't want them to see.
            if (filters.creatorFilter || filters.assignerFilter) {
                await authorizeSpaceAccess(context, spaceId);
            }
        },
        async () => {
            await runAllPromises(
                sorts.map(async sort => {
                    switch (sort.type) {
                        case "ParentPosition": {
                            // You are not allowed to sort by parent position unless you are also filtering
                            // by the parent task. This is because sorting by parent position reveals
                            // information about the parent task which might not be visible to you.
                            if (filters.parentFilter) break;

                            throw new PermissionDeniedError(
                                "Must filter by a parent task to sort by parent position",
                            );
                        }
                        case "CollectionPosition": {
                            // Optimization: If our filter contains the collection then we will authorize
                            // view access above.
                            if (
                                filters.collectionsFilter?.some(clause =>
                                    clause.has(sort.collectionId),
                                )
                            ) {
                                break;
                            }

                            const {spaceId: collectionSpaceId} =
                                await authorizeTaskCollectionAccess(
                                    context,
                                    sort.collectionId,
                                    "View",
                                    loaders,
                                );

                            if (spaceId !== collectionSpaceId) {
                                throw new PermissionDeniedError(
                                    "Task collection is in the wrong space",
                                );
                            }
                            break;
                        }
                        case "AssigneePosition": {
                            // A task's assignee position is private to the account whom the task is
                            // assigned. Only allow sorting by assignee position when also filtering for
                            // tasks assigned to you.
                            if (
                                context.actor.type === "Session" &&
                                filters.assigneeFilter?.accountIds.size === 1 &&
                                filters.assigneeFilter.accountIds.has(context.actor.getAccountId())
                            ) {
                                // If the actor doesn't have space access then throw an "actor doesn't have
                                // space access" error.
                                await authorizeSpaceAccess(context, spaceId);

                                break;
                            }

                            throw new PermissionDeniedError(
                                "Must filter assignee to session account to sort by assignee position",
                            );
                        }
                        case "Creator":
                        case "Assigner": {
                            // Must have space access to sort by hidden accounts. We only send account
                            // information for assignees to actors without space access (e.g. anonymous
                            // actors viewing a collection they have access to via `urlGrant`). Allowing an
                            // actor without space access to sort by hidden accounts could reveal
                            // information we don't want them to see.
                            await authorizeSpaceAccess(context, spaceId);
                            break;
                        }
                        default:
                            break;
                    }
                }),
            );
        },
    );

    if (!hasAccess) {
        // If the actor doesn't have space access then throw an "actor doesn't have
        // space access" error.
        await authorizeSpaceAccess(context, spaceId);

        throw new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        );
    }
}

/**
 * If you have a `TaskIndexDoc` then you have all the data that's in a
 * `TaskEssentialAttributesItem`. This function converts between the two
 * formats.
 *
 * Be careful when using this function! Loading a `TaskIndexDoc` from
 * OpenSearch is at least 30sec behind a `TaskEssentialAttributesItem` loaded
 * from DynamoDB since 30sec is our OpenSearch refresh rate. If you're in
 * `TaskRealtimeService` then you have up-to-date `TaskIndexDoc`s in
 * `TaskRealtimeStore` so those are ok to use with this function.
 */
function convertTaskIndexDocToItem(task: TaskIndexDoc): TaskEssentialAttributesItemBase {
    return {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId: task.id,
        spaceId: task.spaceId,
        creatorId: task.creator.accountId,
        createdTime: task.createdTime.absoluteTime,
        deletedTime: isTaskIndexDocDeleted(task) ? task.rawDeletedTime : null,
        statusType: new TaskStatusTypeRegister(task.status.value.type, task.status.version),
        parentTaskId: task.parent.taskId,
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,
        collections: task.collections.raw.collections,
        assigneeId: new TaskAssigneeAccountIdRegister(
            task.assignee.value?.assignee.accountId ?? null,
            task.assignee.version,
        ),
    };
}

/**
 * If you have a `TaskCollectionIndexDoc` then you have all the data that's in
 * a `TaskCollectionEssentialAttributesItem`. This function converts between
 * the two formats.
 *
 * Be careful when using this function! See the disclaimer on
 * `convertTaskIndexDocToItem()`.
 */
function convertTaskCollectionIndexDocToItem(
    collection: TaskCollectionIndexDoc,
): TaskCollectionEssentialAttributesItemBase {
    return {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        creatorId: collection.creatorId,
        rawDeletedTime: collection.rawDeletedTime,
        rawUndeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        color: collection.color,
        accessPolicy: collection.accessPolicy,
    };
}

/**
 * Get the current notes content for some task without the `ContentReferences`
 * needed to render.
 */
export function getTaskNotesContentWithoutReferences(
    context: ServerActionContext,
    taskId: TaskId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContent;
    stepCountByNonCreatorAccountId: TaskStepCountByAccountId;
}> {
    return authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
        context,
        taskId,
        "View",
        async ({item, notesItem}) => ({
            spaceId: item.spaceId,
            version: notesItem?.version ?? 0,
            content: notesItem?.content ?? emptyTaskNotesContent,
            stepCountByNonCreatorAccountId:
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map()),
        }),
        {consistency},
    );
}

/**
 * Get the current notes content for some task while loading some custom
 * references.
 */
export function getTaskNotesContentWithCustomReferences<Content>(
    context: ServerAccountActionContext,
    taskId: TaskId,
    buildContent: (
        context: ServerAccountActionContext,
        spaceId: SpaceId,
        task: {assigneeId: AccountId | null; content: TaskNotesContent},
    ) => Promise<Content>,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: Content;
    stepCountByNonCreatorAccountId: TaskStepCountByAccountId;
}> {
    return authorizeTaskAccessAndGetCommentsSummaryAndNotesItems(
        context,
        taskId,
        "View",
        async ({item, notesItem}) => ({
            spaceId: item.spaceId,
            version: notesItem?.version ?? 0,
            content: await buildContent(context, item.spaceId, {
                assigneeId: item.assigneeId.value,
                content: notesItem?.content ?? emptyTaskNotesContent,
            }),
            stepCountByNonCreatorAccountId:
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map()),
        }),
        {consistency},
    );
}

/**
 * Get the current notes content for some task. Returns null if the task
 * doesn't exist.
 */
export function getTaskNotesContentIfExists(
    context: ServerActionContext,
    taskId: TaskId,
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContentWithReferences;
} | null> {
    return authorizeTaskAccessAndGetCommentsSummaryAndNotesItemsIfExists(
        context,
        taskId,
        "View",
        async ({item, notesItem}) => ({
            spaceId: item.spaceId,
            version: notesItem?.version ?? 0,
            content: {
                doc: notesItem?.content ?? emptyTaskNotesContent,
                references: await getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
                    context,
                    item.spaceId,
                    FileTaskAuthorizer.bind({type: "TaskNotes", taskId}),
                    notesItem?.content ?? emptyTaskNotesContent,
                    // Preload small files so we don't have to show a placeholder for them. This
                    // improves UX at the cost slowing the initial load. Right now we preload
                    // <100kb files up to 400kb. We'll have to tune this to find the right balance
                    // between UX and the performance hit.
                    {withPreloadedFiles: true},
                ),
            },
        }),
    );
}

/**
 * Get the current notes content for some task. Throws an error if the task
 * doesn't exist.
 */
export async function getTaskNotesContent(
    context: ServerActionContext,
    taskId: TaskId,
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: TaskNotesContentWithReferences;
}> {
    const taskNotes = await getTaskNotesContentIfExists(context, taskId);
    if (!taskNotes) throw createTaskNotFoundError(taskId);
    return taskNotes;
}

/**
 * Updates the task's notes with the provided steps. Uses optimistic
 * concurrency control so rejects any updates that have `version` set to the
 * wrong value.
 *
 * It's important that task note updating should be solely managed by the
 * `TaskNotesCollaborationService` Durable Object. If you get an incorrect
 * version error, we don't know what steps you're missing since we don't keep
 * track of old steps (unlike document content). There’s no way to recover!
 */
export function updateTaskNotesContent(
    context: ServerSessionActionContext,
    {
        spaceId,
        taskId,
        version,
        steps,
    }: {
        spaceId: SpaceId;
        taskId: TaskId;
        version: number;
        steps: ReadonlyArray<Step>;
    },
) {
    return withSendTaskIndexSearchEntityJobIfNeeded(context, {spaceId, taskId}, () => {
        return context.dynamo.retryTransaction(async context => {
            const [taskItem, notesItem] = await runAllPromises([
                (async () => {
                    const taskItem = await TaskTable.getItem(context, {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId,
                    });

                    const expectedAccessLevel = "Edit";

                    await authorizeTaskItemAccess(context, taskItem, expectedAccessLevel, {
                        getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, null),
                        getCollectionItem: collectionId =>
                            getTaskCollectionItemForAuthorization(context, collectionId, null),
                    });

                    if (taskItem.spaceId !== spaceId) {
                        throw new FailedPreconditionError("Task is in unexpected space");
                    }

                    return taskItem;
                })(),
                TaskTable.getItemIfExists(context, {
                    partitionType: "Task",
                    sortRangeType: "Notes",
                    taskId,
                }),
            ]);

            let newStepCountByAccountId =
                notesItem?.stepCountByAccountId ?? new TaskStepCountByAccountId(new Map());

            // Keep track of how much each account contributed to the task's notes.
            if (context.actor.getAccountId() !== taskItem.creatorId) {
                const actualNewStepCountByAccountId = new Map(newStepCountByAccountId.get());

                const stepCount =
                    actualNewStepCountByAccountId.get(context.actor.getAccountId()) ?? 0;

                actualNewStepCountByAccountId.set(
                    context.actor.getAccountId(),
                    stepCount + steps.length,
                );

                newStepCountByAccountId = new TaskStepCountByAccountId(
                    actualNewStepCountByAccountId,
                );
            }

            let newNotesItem: TaskNotesItem;

            // If the notes item doesn't exist yet then create it.
            if (!notesItem) {
                if (version !== 0) throw new FailedPreconditionError("Incorrect version");

                let content = emptyTaskNotesContent;

                for (const step of steps) {
                    const stepResult = step.apply(content);
                    if (!stepResult.doc)
                        throw new FailedPreconditionError("Couldn’t apply step to content");

                    assert(isTaskNotesContent(stepResult.doc));
                    content = stepResult.doc;
                }

                newNotesItem = {
                    partitionType: "Task",
                    sortRangeType: "Notes",
                    spaceId: taskItem.spaceId,
                    taskId,
                    version: steps.length,
                    content,
                    stepCountByAccountId: newStepCountByAccountId,
                };
            } else {
                if (version !== notesItem.version)
                    throw new FailedPreconditionError("Incorrect version");

                let content = notesItem.content;

                for (const step of steps) {
                    const stepResult = step.apply(content);
                    if (!stepResult.doc)
                        throw new FailedPreconditionError("Couldn’t apply step to content");

                    assert(isTaskNotesContent(stepResult.doc));
                    content = stepResult.doc;
                }

                newNotesItem = {
                    ...notesItem,
                    version: notesItem.version + steps.length,
                    content,
                    stepCountByAccountId: newStepCountByAccountId,
                };
            }

            // If a task's notes changed and there’s a lease, invalidate the lease so the
            // account who owns the lease can't see changes to a task they shouldn't have
            // access to.
            if (taskItem.validLeaseId === null) {
                if (notesItem === null) {
                    await TaskTable.createItem(context, newNotesItem);
                } else {
                    await TaskTable.directlyUpdateItem(context, newNotesItem);
                }
            } else {
                await DynamoTableSchema.executeTransaction(context, [
                    TaskTable.transactionDirectlyUpdateItem({
                        ...taskItem,
                        // Invalidate any leases on this task now that another user has updated it.
                        validLeaseId: null,
                    }),
                    notesItem === null
                        ? TaskTable.transactionCreateItem(newNotesItem)
                        : TaskTable.transactionDirectlyUpdateItem(newNotesItem),
                ]);
            }
        });
    });
}

// After how many months should our expansion state expire?
//
// We expire expansion state to not incur storage costs for dead views,
// accounts, or browsers.
//
// The expiration time should be long enough that the user doesn't remember or
// doesn't care about losing any expansion state.
//
// We pick this value so that if a user looks at a grid view once a quarter,
// expanded task state is maintained.
const taskGridViewExpansionStateExpirationMonths = 4;

// After how many months should we renew expansion state expiration times?
//
// We renew expansion state items that are close to expiring if the user
// accesses them so we don't expire expansion states that are actively being
// used.
const taskGridViewExpansionStateExpirationRenewalMonths = 2;

/**
 * Get the key we use for storing the expansion state of a grid view.
 *
 * Uniqueness is not guaranteed! We hash `filters` and `sorts` to avoid storing
 * the entire query definition. However as with any hash function collisions
 * are very unlikely but possible.
 *
 * For the purpose of grid view expansion state we find collisions acceptable
 * given expansion state is also partitioned by `SpaceId`, `AccountId`, and
 * `BrowserId`.
 */
function getTaskGridViewExpansionStateKey({
    filters,
    sorts,
}: {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}) {
    const queryKey = stringifyForDeepEqualCheck<CalendarDate>({filters, sorts}, date =>
        date.toString(),
    );

    const queryKeyMidpointIndex = Math.floor(queryKey.length / 2);

    const queryKey1 = queryKey.slice(0, queryKeyMidpointIndex);
    const queryKey2 = queryKey.slice(queryKeyMidpointIndex);

    // We use two hashes (one on the first half of the key, one on the second half)
    // as any easy way to reduce collision chance. However collisions are still not
    // impossible.
    //
    // Thread describing this issue:
    // https://contributors.scala-lang.org/t/murmur-hash-conflicts-when-hashing-many-items/1506
    const queryKeyHash1 = murmurhash.v3(queryKey1).toString(16).padStart(8, "0");
    const queryKeyHash2 = murmurhash.v3(queryKey2).toString(16).padStart(8, "0");

    return `${queryKeyHash1}${queryKeyHash2}`;
}

/**
 * Update the `TaskGridViewExpansionState` for this browser.
 */
export async function updateTaskGridViewExpansionState(
    context: ServerSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
        state,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        state: TaskGridViewExpansionState;
    },
) {
    await authorizeSpaceAccess(context, spaceId);

    if (state === null) {
        await TaskTable.deleteItemWithKeyIfExists(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
        });
    } else {
        await TaskTable.createOrReplaceItem(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
            state,
            expirationTime: addMonths(new Date(), taskGridViewExpansionStateExpirationMonths),
        });
    }
}

/**
 * Get the `TaskGridViewExpansionState` for this browser. If the state hasn't
 * been updated in a while and is about to expire then we extend the expiration
 * time.
 */
export async function getTaskGridViewExpansionState(
    context: TaskRealtimeSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
): Promise<TaskGridViewExpansionState> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await TaskTable.getItemIfExists(context, {
        partitionType: "TaskGridViewExpansionState",
        sortRangeType: "Attributes",
        spaceId,
        accountId: context.actor.getAccountId(),
        browserId,
        viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
    });

    // If the grid view's expansion state hasn't been updated in a while but is
    // still being read then we want to extend its expiration time.
    if (
        item &&
        differenceInMonths(item.expirationTime, new Date()) <=
            taskGridViewExpansionStateExpirationRenewalMonths
    ) {
        const newExpirationTime = addMonths(new Date(), taskGridViewExpansionStateExpirationMonths);

        context.process.waitUntil(
            TaskTable.createOrReplaceItem(context, {
                ...item,
                expirationTime: newExpirationTime,
            }),
        );
    }

    return item?.state ?? null;
}

function createTaskCollectionModelSearchResultFromItem(
    collectionItem: TaskCollectionEssentialAttributesItem,
): TaskCollectionModelSearchResult {
    return {
        openTaskCount: collectionItem.openTaskCount,
        lastTaskAddedTime: collectionItem.lastTaskAddedTime,
        collection: new TaskCollectionModel({
            id: collectionItem.collectionId,
            spaceId: collectionItem.spaceId,
            createdTime: collectionItem.createdTime,
            creatorId: collectionItem.creatorId,
            deletedTime: collectionItem.rawDeletedTime,
            undeletedTime: collectionItem.rawUndeletedTime,
            name: collectionItem.name,
            color: collectionItem.color,
            accessPolicy: collectionItem.accessPolicy,
        }),
    };
}

/**
 * Print the body text snippet we include in a task collection search result.
 * If the user doesn't have access to the task collection then we return null
 * instead of throwing. Since the search index (which calls this function) may
 * have out-of-date data.
 */
export async function getTaskCollectionSearchResultBodyTextSnippetIfPossible(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
    timeZone: TimeZone,
    currentTime: Date,
): Promise<string | null> {
    const collectionItem = await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });

    // Deleted collections get no snippet.
    if (isTaskCollectionItemDeleted(collectionItem)) return null;

    const expectedAccessLevel = "View";

    // We need to double check that we have access to this collection. Since the
    // collection search index might be out of date.
    const result = await authorizeTaskCollectionItemAccessIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
    );
    if (!result.ok) return null;

    return printTaskCollectionSearchResultBodyTextSnippet({
        timeZone,
        currentTime,
        createdTime: new Date(collectionItem.createdTime[0]),
        lastTaskAddedTime: collectionItem.lastTaskAddedTime
            ? new Date(collectionItem.lastTaskAddedTime[0])
            : null,
        openTaskCount: collectionItem.openTaskCount,
    });
}

/**
 * Get the search result description of a task collection if the task
 * collection exists and the actor has access to it. Throws an error if the
 * actor doesn't have access to the task collection. If the task collection
 * exists but is deleted we return it if the user has access.
 */
export async function getTaskCollectionSearchResult(
    context: ServerActionContext,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionModelSearchResult> {
    const collectionItem = await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });

    const expectedAccessLevel = "View";

    // We need to double check that we have access to this collection. Since the
    // collection search index might be out of date.
    await authorizeTaskCollectionItemAccess(context, collectionItem, expectedAccessLevel);

    return createTaskCollectionModelSearchResultFromItem(collectionItem);
}

/**
 * Get the search result description of a task collection if the task
 * collection exists and the actor has access to it. Returns null if the
 * collection doesn't exist or the account doesn't have access. If the task
 * collection exists but is deleted we return null.
 */
export async function getTaskCollectionSearchResultIfPossible(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
): Promise<Result<TaskCollectionModelSearchResult, ErrorBase> | null> {
    const collectionItem = await TaskTable.getItem(context, {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId,
    });

    // Don't include deleted collections in results.
    if (isTaskCollectionItemDeleted(collectionItem)) return null;

    const expectedAccessLevel = "View";

    // We need to double check that we have access to this collection. Since the
    // collection search index might be out of date.
    const result = await authorizeTaskCollectionItemAccessIfPossible(
        context,
        collectionItem,
        expectedAccessLevel,
    );
    if (!result.ok) return result;

    return {ok: true, value: createTaskCollectionModelSearchResultFromItem(collectionItem)};
}
