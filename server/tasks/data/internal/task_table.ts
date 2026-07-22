import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {
    MessageStreamAttributesSchema,
    MessageStreamPartSchema,
} from "~/server/messaging/helpers/message_stream_schema.js";
import {authorizeTaskAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_access_if_possible.js";
import {TaskStepCountByAccountId} from "~/server/tasks/data/task_step_count_by_account_id.js";
import {AccessLevel, AccessPolicyRegister} from "~/shared/access/access_policy.js";
import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {zeroHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapResult} from "~/shared/helpers/control/map_result.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {
    VtencBigUint64Set,
    decodeVtencBigUint64List,
    encodeVtencBigUint64Set,
} from "~/shared/helpers/number/vtenc_big_uint_64_set.js";
import {
    AccountId,
    BrowserId,
    ContentEditorClientId,
    SpaceId,
    TaskActionTransactionId,
    TaskActionTransactionLeaseId,
    TaskCollectionId,
    TaskId,
    TaskRealtimeClientId,
} from "~/shared/id/types/id_types.js";
import {MessagePayloadSchema} from "~/shared/messaging/message_schema.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {IdByteSetSchema} from "~/shared/schema/helpers/id_byte_set_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskActionSchema} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskCreatorFromSchema} from "~/shared/tasks/task_creator.js";
import {createTaskNotFoundError} from "~/shared/tasks/task_error_messages.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionStateSchema,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskLayoutRegister} from "~/shared/tasks/task_layout.js";
import {
    TaskNotesContentSchema,
    TaskNotesContentStepSchema,
} from "~/shared/tasks/task_notes_content_schema.js";
import {
    TaskQueryDefaultsRegister,
    emptyTaskQueryDefaults,
} from "~/shared/tasks/task_query_defaults.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";

/**
 * The task actions table is the canonical representation of the data in our task
 * system. Everything else is derived from task actions. We should be able to
 * rebuild any of our structures from the task actions table. When an action
 * commits to this table it has been accepted by our system and should propagate to
 * all realtime clients.
 *
 * In practice, we only end up reading the last ~24 hours of task actions as we
 * incrementally keep other databases, like OpenSearch, up-to-date. Eventually we
 * should find a way to archive old actions. We MUST keep old actions around since
 * we consider actions to be the canonical representation of data in our task
 * system but DynamoDB storage is expensive. Realistically old actions are
 * basically only accessed in disaster recovery scenarios so they can go into low
 * cost S3 storage.
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
                         * An `Id` for uniquely representing an action. Also used to disambiguate actions
                         * with identical `committedTime`s.
                         */
                        actionTransactionId: DynamoKeyAttributeSchema.id<TaskActionTransactionId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * Actions which should always be atomically applied together.
                         */
                        actions: Schema.array(TaskActionSchema),

                        /**
                         * Has this action transaction been processed? To consider an action transaction
                         * processed we must have:
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
                         * Nullable since action transactions before 2023-01-02 did not save the `actorId`.
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

export const TaskStatusTypeRegister = createCrdtRegister(
    Schema.enum<TaskStatus["type"]>(["Open", "Closed"]),
);

export const TaskAssigneeAccountIdRegister = createCrdtRegister(Schema.id<AccountId>().nullable());

/**
 * Data related to tasks. Contains some views of task actions (e.g. the
 * `EssentialAttributes` items) and some data unrelated to task fields which don't
 * participate in querying (like notes, comments, revision history).
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
                // compatibility to avoid crashes since we have objects of this type saved in the
                // database.
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
                // search affinity system. We've sense migrated task collections to use the generic
                // search affinity system but we have to keep this definition around for backwards
                // compatibility. You shouldn't use items of this type! Eventually all the old task
                // collection affinity items will expire and we can remove this.
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
                 * When an account performs an action that causes them to lose access to some task,
                 * we grant them temporary permission to execute some actions that will undo that
                 * change in case they made a mistake. The account's permission to do so is
                 * represented by a "lease". Given the ability to take action on a task you no
                 * longer have access to is powerful in the hands of an attacker, leases have the
                 * following restrictions:
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
                 * view. Then it tries to create a lease with the action transaction that caused
                 * the task to leave.
                 *
                 * We don't check that the actions you're leasing are an inversion of the actions
                 * you're committing (even though that's what we expect from the client). If an
                 * attack provides an unrelated set of actions that's ok. Leases extend how long
                 * you can commit actions that were valid at the time of lease creation. So actions
                 * must be safe when leased in the first place.
                 *
                 * ## Why restriction 3?
                 *
                 * Updating a task in any way invalidates any lease currently held on the task.
                 * Example attack this protects against:
                 *
                 * 1. Manager assigns a task to their report asking them to fill out their
                 *    performance self review
                 * 2. Report fills out the self review section and assigns it back to the manager
                 *    (creating a lease to add them back as the assignee)
                 * 3. After the manager fills out their notes, the report executes the lease.
                 *    Bringing the task back to them so they can see the private notes.
                 *
                 * By invalidating a lease after an update sophisticated users can't do this
                 * attack.
                 *
                 * In principle, a user could be allowed to permanently view a task at the moment
                 * they lost access. Since a user could trivially copy the task down to their
                 * computer while they have access. However a user is not allowed to see new
                 * updates after they lose access. (In practice, a user can see updates until
                 * `WebSocketServer` reauthorizes their WebSocket connection which may take a
                 * couple minutes.) Invalidating leases prevents the user from seeing new updates
                 * after they lose access.
                 *
                 * (In the example attack we propose, a regular user could still add the task to a
                 * private collection of theirs to retain access, this is expected. This case
                 * shouldn't weaken our security posture elsewhere. We may need protection against
                 * retaining access with a private collection someday.)
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
                         * The account who created this collection. Unlike tasks, the `creatorId` does not
                         * influence permissions. Only the `accessPolicy` influences permissions. The
                         * collection creator may lose access if they are removed from the `accessPolicy`.
                         */
                        creatorId: Schema.id<AccountId>().nullable().default(null),
                        creatorFrom: TaskCreatorFromSchema.nullable().default(null),

                        // We keep track of both `rawDeletedTime` and `rawUndeletedTime` for our collection
                        // in DynamoDB so we can create a full `TaskCollectionModel`. The collection is
                        // considered deleted if `rawDeletedTime` is null or `rawUndeletedTime` is larger
                        // than `rawDeletedTime`.
                        rawDeletedTime: HybridLogicalTimeSchema.nullable(),
                        rawUndeletedTime: HybridLogicalTimeSchema.nullable(),

                        // We include the `name` and `color` of our collection in its `EssentialAttributes`
                        // since we load the `EssentialAttributes` object to render searched collections.
                        name: LabelStringRegister.schema,
                        color: TaskCollectionColorRegister.schema,

                        /**
                         * Who is allowed to access the collection and with what permission level.
                         */
                        accessPolicy: AccessPolicyRegister.schema,

                        /**
                         * The default filters/sorts applied for everyone when they open the collection
                         * without explicit filters/sorts of their own (e.g. filters in the URL).
                         *
                         * Included in the collection's `EssentialAttributes` so we can apply default
                         * filters/sorts to the initial query in our task collection route loader without
                         * an extra read. The loader already loads this item for authorization.
                         *
                         * Collections created before defaults existed don't have this property so we
                         * default to an empty register which loses to any update.
                         */
                        defaults: TaskQueryDefaultsRegister.schema.default(
                            () =>
                                new TaskQueryDefaultsRegister(
                                    emptyTaskQueryDefaults,
                                    zeroHybridLogicalTime,
                                ),
                        ),

                        /**
                         * Have we added a feed candidate entry for the collection? We add an entry when
                         * the collection is shared with some `defaultGrant`. But if you revoke the
                         * `defaultGrant` then add it again we don't want to add another feed candidate
                         * entry.
                         */
                        hasAddedFeedCandidateEntry: Schema.boolean.default(false),

                        /**
                         * The total number of tasks in the collection. Open and closed. Not including
                         * deleted tasks.
                         *
                         * Doesn't use the same `addedChildTaskCount`/`removedChildTaskCount` format as a
                         * task since these numbers aren't shared over realtime (since they would update so
                         * frequently). Though if we wanted to migrate to that format it should be pretty
                         * easy: rename this property to `addedTaskCount` and add a `removedTaskCount`
                         * property that defaults to 0.
                         */
                        taskCount: Schema.integer,

                        /**
                         * The number of open tasks in the collection. Not including deleted tasks. You can
                         * figure out the number of closed tasks with `taskCount - openTaskCount`.
                         */
                        openTaskCount: Schema.integer,

                        /**
                         * The last time a task was added to this collection.
                         *
                         * We present this to users as the task's last updated time.
                         *
                         * Unfortunately, DynamoDB doesn't have a `max()` function in update expressions so
                         * we can't update this perfectly atomically. This value may not monotonically go
                         * forwards and instead temporarily go backwards if we commit an action with an
                         * older time than an action we previously committed.
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
                         * The account who created this task.
                         *
                         * The creator is included in the task's access policy by default, but may lose
                         * access if removed from the access policy.
                         */
                        creatorId: Schema.id<AccountId>(),
                        creatorFrom: TaskCreatorFromSchema.nullable().default(null),

                        /**
                         * The time this task was created.
                         */
                        createdTime: HybridLogicalTimeSchema,

                        /**
                         * The time this task was deleted. We keep a record of deleted tasks so they may be
                         * undeleted. It's critical to check this property when looking at task items so
                         * you know whether it's been deleted or not.
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
                         * We inherit permissions from this task. So if you have edit access to the parent
                         * task then you also have edit access to this task.
                         *
                         * You may have broader permissions to a child task. For example, you can edit a
                         * child task but not its parent task. Or view a child task but not its parent
                         * task.
                         *
                         * ## Parent deletion
                         *
                         * When a parent task is deleted we don't update the `parentTaskId` attribute of
                         * child tasks. You must be careful to check that the `parentTaskId` task actually
                         * exists and is not deleted. We leave gravestones around for deleted tasks so you
                         * should always be able to find a task object even if it's deleted.
                         *
                         * If the parent task is undeleted the child task is again unaffected.
                         *
                         * ## Depth and circular dependency restrictions
                         *
                         * There is no restriction on how deep you can nest child tasks.
                         *
                         * Task circular dependencies are not allowed. Though clients may temporarily have
                         * circular dependencies. This is because:
                         *
                         * - Task actions may be applied out-of-order
                         * - We may not load the entire task parent hierarchy so we won't know to reject an
                         *   operation that creates a circular dependency
                         *
                         * So clients should be careful not to crash on circular dependencies. However, a
                         * canonical task representation will never have circular dependencies.
                         *
                         * There may also be items in this table that have a circular dependency because
                         * deleted tasks do not count in a dependency chain. If you are iterating through a
                         * parent task chain, make sure to `break` if you see a deleted parent task.
                         */
                        parentTaskId: TaskParentTaskIdRegister.schema,

                        // See the documentation of `TaskUpdateChildrenCountsAction` for more information.
                        addedChildTaskCount: Schema.integer,
                        removedChildTaskCount: Schema.integer,
                        addedClosedChildTaskCount: Schema.integer,
                        removedClosedChildTaskCount: Schema.integer,

                        /**
                         * All of this task's current children.
                         *
                         * Stored in binary since that's much more space efficient than storing as strings.
                         * 1kb (used by 1 WCU) costs ~64 128 bit `Id`s.
                         *
                         * Unlike `addedChildTaskCount` these are our current child tasks. If a child task
                         * is removed then we remove it from the set. If a child task is deleted it stays
                         * in the set, though.
                         */
                        childTaskIds: IdByteSetSchema.get<TaskId>(),

                        /**
                         * The collections this task is a part of. A task inherits the highest access level
                         * from its collections.
                         */
                        collections: TaskCollectionSet.schema,

                        /**
                         * The account which was assigned this task.
                         */
                        assigneeId: TaskAssigneeAccountIdRegister.schema,

                        /**
                         * The layout of the task.
                         *
                         * Project tasks created before 2026-03-13 (or whenever this commit is deployed)
                         * will have this set to null since we didn't add it until later. There should be
                         * <20 project tasks in this state in the database. We haven't run a migration yet
                         * to make sure the tasks are updated since we're not using this register for
                         * anything too critical yet.
                         */
                        layout: TaskLayoutRegister.schema.nullable().default(null),

                        /**
                         * Who is allowed to access this task and with what permission level.
                         *
                         * If null, we default to a policy that only includes the task creator.
                         */
                        accessPolicy: AccessPolicyRegister.schema.nullable().default(null),

                        /**
                         * Have we added a feed candidate entry for the task? We add an entry when the task
                         * is shared with some `defaultGrant`. But if you revoke the `defaultGrant` then
                         * add it again we don't want to add another feed candidate entry.
                         *
                         * We include the event type we added to the feed since our behavior changes
                         * slightly depending on the event types we've added so far.
                         */
                        feed: Schema.enum(["AddedAccountCandidateEntry", "AddedCandidateEntry"])
                            .nullable()
                            .default(null),

                        /**
                         * Leases are valid as long as the task is unmodified. This is how we keep track of
                         * that. When we create a lease it's set here. When the task is modified this is
                         * set to null.
                         */
                        validLeaseId: Schema.id<TaskActionTransactionLeaseId>()
                            .nullable()
                            .default(null),
                    }),
                },

                /**
                 * Information regarding the task's comments. Including comment count and the next
                 * comment index.
                 */
                // NOTE(calebmer, 2024-06-05): Comment information is in a separate DynamoDB item
                // for tasks unlike the `commentsSummary` or `messagesSummary` properties in the
                // chat, forum, and document messaging systems which live in the main attributes
                // object for their respective entities. It's hard to predict without sufficient
                // production data, but I'm starting to suspect that for messaging rooms that
                // themselves carry a lot of data (just posts and tasks right now) it may be more
                // efficient to have a separate `CommentsSummary` item than to have a
                // `commentsSummary` property on the main item.
                //
                // If we had a `commentsSummary` property in a task's `EssentialAttributes` item
                // then if the combined object exceeds 1kb we have to pay an extra DynamoDB WCU
                // when either updating `EssentialAttributes` or creating/updating any comment. In
                // binary ~7 `Id`s (at 128 bits each) are enough to fill a 1kb WCU. So a separate
                // `CommentsSummary` item saves WCUs.
                //
                // A separate `CommentsSummary` item doesn't increase our DynamoDB read cost (RCUs)
                // if we're careful to read them with a DynamoDB `query()` (instead of `getItem()`)
                // since they're physically next to each other on disk.
                {
                    name: "CommentsSummary",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The index of the next comment.
                         */
                        nextCommentIndex: Schema.integer.min(0),

                        /**
                         * All the accounts which have commented on the task and the number of comments
                         * they have made. The map is ordered by when the account first commented on the
                         * task.
                         *
                         * This map can grow unbounded. When a user deletes a comment it leaves a
                         * gravestone so comment counts should never be decremented.
                         */
                        commentCountByAuthorId: Schema.map(
                            Schema.id<AccountId>(),
                            Schema.integer.min(1),
                        ),

                        /**
                         * All the accounts which have been mentioned at some point in the task's comments
                         * or task's content and how many times the account was mentioned.
                         *
                         * Accounts that exist in the map with a mention count of zero have a special
                         * meaning:
                         *
                         * - If an account exists in the map they were mentioned at some point
                         * - If an account exists in the map with a mention count of zero then they were
                         *   mentioned at some point but all mentions have been removed by updates
                         * - If an account does not exist in the map they were never mentioned in the task
                         */
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
                 * read/write path for task notes to avoid paying the storage cost of putting notes
                 * in OpenSearch and the load cost of frequent writes on `TaskRealtimeService`.
                 *
                 * Reading and writing task notes needs basically the same implementation as
                 * document content. However, since we expect task notes to be shorter, less
                 * collaborative, and unlikely to be edited after they're initially written we're
                 * going for a simpler implementation of realtime content editing.
                 *
                 * This sort key range is analogous to a document's `Snapshot` sort key range, but
                 * while we keep track of a task note's step history, we don't queue updates to it
                 * like `StepTransactionsAfterSnapshot` does for documents. Instead, we update it
                 * immediately on new steps.
                 */
                {
                    name: "Notes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The space the task is in. Copied from our `EssentialAttributes` item to avoid an
                         * extra fetch when we just need the `SpaceId`.
                         */
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The current content version. Keeps track of the number of steps taken against
                         * this content.
                         */
                        version: Schema.integer,

                        /**
                         * The time this notes item was originally created.
                         */
                        createdTime: Schema.date.default(new Date("2026-06-11T11:11:00.000Z")),

                        /**
                         * The time this item was last updated. If undefined, this item has never been
                         * updated since it was originally created.
                         */
                        lastUpdatedTime: Schema.date.optional(),

                        /**
                         * The current notes content.
                         */
                        content: TaskNotesContentSchema,

                        /**
                         * Keep track of the number of steps contributed by various `AccountId`s after
                         * `version` 0. Excluding steps contributed by `creatorId`. You can compute
                         * `creatorId`'s `stepCount` by adding all step counts in this map then subtracting
                         * that from `version`.
                         *
                         * This is a simple way to determine who's contributed to the task and by what
                         * amount. However, this is only a valid measure of the amount each account has
                         * contributed assuming the relative added content size of each step is the same.
                         * It's possible an account pastes a lot of content and that's only counted as one
                         * step. Approaches of measuring contribution that take pastes into effect would be
                         * less efficient and more prone to error.
                         *
                         * We serialize the map to binary. An `Id` is 128 bits in binary and 208 bits in
                         * UTF-8. That means for one 4kb DynamoDB read unit we can fit 250 `Id`s in binary
                         * but only 153 `Id`s in UTF-8.
                         *
                         * This map was not around prior to 2024-01-01. So documents created before then
                         * (and until this deploys) will not have an accurate step count map. All steps
                         * will be counted towards the `creatorId`.
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
                 * Step transactions that have been applied to the task notes.
                 *
                 * This is named to mirror how documents name their step transactions even though
                 * task notes don't have a snapshot. Instead, the `Notes` content is always updated
                 * with the latest steps (effectively the same as a snapshot), and all previous
                 * steps are kept in this sort range.
                 */
                {
                    name: "NotesStepTransactionsBeforeSnapshot",
                    sortKeyAttributes: {
                        startVersion: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        createdTime: Schema.date,
                        steps: Schema.array(TaskNotesContentStepSchema),
                        invertedSteps: Schema.array(TaskNotesContentStepSchema),
                        clientId: Schema.id<ContentEditorClientId>(),
                        accountId: Schema.id<AccountId>().nullable().default(null),
                        fromBotAccountId: Schema.id<AccountId>().nullable().default(null),
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
                        createdTimeZone: TimeZoneSchema.default(defaultTimeZone),
                        payload: MessagePayloadSchema,
                    }),
                    childSortRanges: [
                        {
                            name: "Stream",
                            sortKeyAttributes: {},
                            attributes: MessageStreamAttributesSchema,
                        },
                        {
                            name: "StreamPart",
                            sortKeyAttributes: {
                                partIndex: DynamoKeyAttributeSchema.integer,
                            },
                            attributes: MessageStreamPartSchema,
                        },
                    ],
                },

                /**
                 * Whenever a message is updated we add a `MessageUpdates` item. So when clients
                 * need to backfill realtime events they missed while disconnected from a WebSocket
                 * server they can query this sort range to catch up.
                 *
                 * The event includes the `messageIndex` and the new `version` of the message.
                 * During backfill we load the new version of the item.
                 *
                 * This sort range has a similar design to the `Events` sort range in
                 * `RynamoTableSchema`.
                 *
                 * IMPORTANT: This does not include realtime events for streaming messages!
                 * Streaming messages are updated with a different realtime system that's more
                 * efficient for the streaming use case.
                 *
                 * Named `MessageUpdates` instead of `CommentUpdates` so we can have shared
                 * utilities for querying this sort range that work across all messaging surfaces.
                 */
                {
                    name: "MessageUpdates",
                    sortKeyAttributes: {
                        // NOTE(calebmer): Reversed so if we ever wanted to backfill in one query we could.
                        // Through a query that starts at the client's last `messageIndex` and ends at the
                        // checkpoint's `eventTime`.
                        eventTime: DynamoKeyAttributeSchema.date.reverse(),
                        // All the data is in the key so we can safely use create-or-replace to add items
                        // to the table without worrying we're overriding some other data.
                        messageIndex: DynamoKeyAttributeSchema.integer,
                        version: DynamoKeyAttributeSchema.integer,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({}),
                },

                // NOTE(calebmer, 2025-10-13): We changed the format for messaging realtime events
                // to a new sort range: `MessageUpdates`. Leaving this around until all old
                // `CommentChangeLog` items expire. At which point we can remove this from the
                // DynamoDB schema.
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.unknown(),
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
    "childTaskIds" | "validLeaseId" | "feed"
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

type TaskNotesStepTransactionItem = DynamoTableItemType<
    typeof TaskTable,
    "Task",
    "NotesStepTransactionsBeforeSnapshot"
>;

export const InternalFileTaskAuthorizer = FileAuthorizer.new(
    TaskTable,
    "Task",
    async (context, target, expectedAccessLevel, options) => {
        let taskId: TaskId;
        let accessLevel: AccessLevel;

        switch (target.type) {
            case "TaskNotes":
                taskId = target.taskId;
                accessLevel = expectedAccessLevel;
                break;
            case "TaskComments":
                taskId = target.taskId;
                accessLevel = "Comment";
                break;
            default:
                throw exhaustive(target);
        }

        const result = await authorizeTaskAccessIfPossible(
            context,
            taskId,
            accessLevel,
            null,
            options,
        );
        if (result === null) return {ok: false, error: createTaskNotFoundError(taskId)};

        return mapResult(result, () => {});
    },
);

export {TaskTable, TaskActionTable, UnprocessedActionTransactionsIndex};
export type {
    TaskActionTransactionItem,
    TaskAccountActionTransactionLeaseItem,
    TaskCommentsSummaryItem,
    TaskEssentialAttributesItemBase,
    TaskCollectionEssentialAttributesItemBase,
    TaskNotesItem,
    TaskNotesStepTransactionItem,
};
