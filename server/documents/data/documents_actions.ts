import {addDays, differenceInMinutes} from "date-fns";
import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {createAccessPolicyForContentCreatedByBot} from "~/server/access/create_access_policy_for_content_created_by_bot.js";
import {createAccessPolicyPermissionDeniedError} from "~/server/access/create_access_policy_permission_denied_error.js";
import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {evaluateDeletedAccess} from "~/server/access/evaluate_deleted_access.js";
import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {getContentReferencesForNode} from "~/server/content/get_content_references.js";
import {getContentReferencesAssumingViewAccessWithOptionalSpaceAccess} from "~/server/content/get_content_references_assuming_view_access_with_optional_space_access.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionCountByAccountIdInContent,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {RynamoTransactionEntry} from "~/server/context/rynamo_transaction_entry.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ServerMinimalBotActionContext} from "~/server/context/server_minimal_action_context.js";
import {ServerSessionActionContextWithPush} from "~/server/context/server_session_action_context_with_push.js";
import {
    DocumentIndexSearchEntityJob,
    DocumentsTable,
    InternalDocumentStepCountByAccountId,
    InternalFileDocumentAuthorizer,
} from "~/server/documents/data/internal/documents_table.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {addFeedAccountCandidateEntry, addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot} from "~/server/files/data/dangerously_get_file_attachment_target_transaction_entry_without_target_authorization_as_bot.js";
import {
    attachFileFromAttachment,
    getFileFromAttachment,
} from "~/server/files/data/files_actions.js";
import {
    ActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {computeUpdateMessageContent} from "~/server/messaging/helpers/compute_update_message_content.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {
    createCantCompleteStaleMessageStreamError,
    createCantPingCompletedMessageStreamError,
    createCantPingStaleMessageStreamError,
    createCantWriteToStaleMessageStreamError,
} from "~/server/messaging/helpers/create_message_stream_errors.js";
import {
    messageStreamIndexSearchEntityDelaySeconds,
    shouldScheduleMessageStreamIndexSearchEntityJob,
} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {MessageStreamAttributes} from "~/server/messaging/helpers/message_stream_schema.js";
import {hasMessageStreamDefinitelyTimedOut} from "~/server/messaging/helpers/message_stream_timeout_ms.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {putMessageApprovalDecisions} from "~/server/messaging/helpers/put_message_approval_decisions.js";
import {
    messagingEventExpirationDays,
    runBackfillMessageUpdates,
} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {
    markSearchAffinityCreateDocumentEntityInteraction,
    markSearchAffinityEntityInteraction,
} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {AccessLevel, AccessPolicy, EffectiveAccessPolicy} from "~/shared/access/access_policy.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {ApiBotWebhookNewMessageEventParent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ContentDuplicationVariableValues,
    applyContentDuplicationVariableValues,
} from "~/shared/content/content_duplication_variable_schema.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {generateDuplicateContentTitle} from "~/shared/content/generate_duplicate_content_title.js";
import {getCollaborativelyUpdateContentResult} from "~/shared/content/get_collaboratively_update_content_result.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    MessageContent,
    createSimpleMessageContent,
} from "~/shared/content/message_content_schema.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {createDocumentCommentThreadSnippetCollector} from "~/shared/documents/create_document_comment_thread_snippet_collector.js";
import {
    DocumentCommentThreadReference,
    DocumentContentWithReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
    DocumentWithOptionalTitleContentProsemirrorSchema,
    assertDocumentContent,
    assertDocumentWithOptionalTitleContent,
    createEmptyDocumentContent,
    isDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {DocumentCreatorFrom} from "~/shared/documents/document_creator_from.js";
import {
    createDocumentCommentNotFoundError,
    createDocumentCommentThreadNotFoundError,
    createDocumentNotFoundError,
    documentDeletedErrorDisplayMessage,
    documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
} from "~/shared/documents/document_error_messages.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    DocumentPreviewModel,
    getDocumentContentTitle,
    getDocumentContentTitleWithoutFallback,
} from "~/shared/documents/document_model.js";
import {getExpectedAccessLevelForUpdateDocumentContentSteps} from "~/shared/documents/get_expected_access_level_for_update_document_content_steps.js";
import {stripDocumentContentCommentMarks} from "~/shared/documents/strip_document_content_comment_marks.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {
    DataLossError,
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
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {Id, assertId, generateId, getMaxId, getMinId, isId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    SiteId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";
import {computeSetMessageReaction} from "~/shared/messaging/compute_set_message_reaction.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {getTruncatedParentMessagesRangeContentWithoutReferences} from "~/shared/messaging/get_truncated_parent_message_range_content_with_references.js";
import {
    createMessageApprovalNotFoundError,
    createMessageApprovalRequiresMessageStreamError,
} from "~/shared/messaging/message_approval_error_messages.js";
import {
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
    MessageExperimentalApproval,
    MessageStreamExperimentalApprovalsPartPayload,
    MessageStreamPartPayload,
    iterateMessageContentPayloadParentIndexes,
} from "~/shared/messaging/message_schema.js";
import {
    MessageUpdatesBackfillResult,
    MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema,
    MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {PutMessageApprovalDecisionsPayload} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {
    visitProsemirrorNode,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {
    AddMarksAfterRemoveAllStep,
    AddMarksAfterRemoveAllStepRange,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * NOTE: this file is currently being split up. We do not anticipate adding more
 * methods here.
 */

// Authorizers must be declared next to their respective Tables, so we must
// re-export from this accessible module.
export const FileDocumentAuthorizer = InternalFileDocumentAuthorizer;

const DocumentStepCountByAccountId = InternalDocumentStepCountByAccountId;
export type DocumentStepCountByAccountId = InstanceType<typeof DocumentStepCountByAccountId>;

/**
 * We are not allowed to export our DynamoDB tables so instead export a function
 * that can only be used in test environments.
 */
export function getDocumentsTableForTest() {
    assert(process.env.NODE_ENV === "test");
    return DocumentsTable;
}

type DocumentAttributesItem = DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes">;
type DocumentAttributesItemDeleted = NonNullable<DocumentAttributesItem["deleted"]>;

type DocumentStepTransactionAfterSnapshotItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "StepTransactionsAfterSnapshot"
>;

type DocumentStepTransactionBeforeSnapshotItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "StepTransactionsBeforeSnapshot"
>;

type DocumentStepTransactionItem =
    | DocumentStepTransactionAfterSnapshotItem
    | DocumentStepTransactionBeforeSnapshotItem;

type DocumentSnapshotItem = DynamoTableItemType<typeof DocumentsTable, "Document", "Snapshot">;

type DocumentCommentThreadItem =
    | DocumentReferencedCommentThreadItem
    | DocumentArchivedCommentThreadItem;

type DocumentReferencedCommentThreadItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "ReferencedCommentThread"
>;

type DocumentArchivedCommentThreadItem = DynamoTableItemType<
    typeof DocumentsTable,
    "Document",
    "ArchivedCommentThread"
>;

/**
 * Scan every document and document comment in our database. Use when migrating
 * data.
 */
export async function* expensiveScanEveryDocumentAndDocumentCommentForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Document"; spaceId: SpaceId; documentId: DocumentId}
    | {
          type: "DocumentComment";
          getSpaceId: () => Promise<SpaceId>;
          documentId: DocumentId;
          commentThreadId: DocumentCommentThreadId;
          commentIndex: number;
      }
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    const spaceIdByDocumentId = new Map<DocumentId, Promise<SpaceId>>();

    for await (const item of DocumentsTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Document", sortRangeType: "Attributes"},
            {partitionType: "DocumentCommentThread", sortRangeType: "Comments"},
        ],
    })) {
        if (item.partitionType === "Document") {
            if (item.sortRangeType !== "Attributes") continue;
            yield {type: "Document", spaceId: item.spaceId, documentId: item.documentId};
        } else if (item.partitionType === "DocumentCommentThread") {
            if (item.sortRangeType !== "Comments") continue;

            yield {
                type: "DocumentComment",
                getSpaceId: () =>
                    getOrSetDefaultMapValue(spaceIdByDocumentId, item.documentId, async () => {
                        const documentItem = await DocumentsTable.getPartialItem(
                            context,
                            {
                                partitionType: "Document",
                                sortRangeType: "Attributes",
                                documentId: item.documentId,
                            },
                            {attributes: ["spaceId"]},
                        );
                        return documentItem.spaceId;
                    }),
                documentId: item.documentId,
                commentThreadId: item.commentThreadId,
                commentIndex: item.commentIndex,
            };
        }
    }
}

const documentIndexSearchEntityJobFastDelaySeconds = 10;
const documentIndexSearchEntityJobFastMaxGeneration = 60;
const documentIndexSearchEntityJobRegularDelaySeconds = 60;

/**
 * If you've been editing the document for more than ~2 consecutive minutes
 * (`(documentIndexSearchEntityJobImmediatelyAddFeedCandidateEntryAfterGeneration * documentIndexSearchEntityJobFastDelaySeconds) / 60`)
 * before sharing the document then we want to immediately add the document as a
 * feed candidate instead of waiting 5 minutes to add the feed candidate.
 */
const documentIndexSearchEntityJobImmediatelyAddFeedCandidateEntryAfterGeneration = 14;

/**
 * The throttle interval for document indexing jobs in seconds. Indexing a document
 * requires reading the entire thing and saving it to OpenSearch which can be
 * expensive. Given how frequently users update documents, we throttle how
 * frequently a document is indexed.
 *
 * When the user first makes an edit to a document we queue an indexing job with
 * this delay. If the user makes an update to the document before the delay has
 * passed then we don't index again. Since when the indexing job finally runs, the
 * update will be picked up. If the user makes an update after the delay has passed
 * then we schedule another indexing job with a new delay.
 *
 * We throttle updates to every 10 seconds for the first ~10 minutes of continuous
 * editing to a document (the first 60 indexes). Then after that we throttle
 * updates to once every 60 seconds. Reindexing large documents can be expensive so
 * we use the number of prior indexes as a proxy for how large a documents is and
 * slow down indexing once it reaches a certain threshold.
 */
function getDocumentIndexSearchEntityJobDelaySeconds(generation: number) {
    // For the first 10 minutes (`fastMaxGeneration * fastDelaySeconds / 60`) update
    // every 10 seconds.
    if (generation <= documentIndexSearchEntityJobFastMaxGeneration)
        return documentIndexSearchEntityJobFastDelaySeconds;

    // After that initial period, update every 60 seconds.
    return documentIndexSearchEntityJobRegularDelaySeconds;
}

/*
 * Creates a new document with no history using the initial content provided.
 *
 * When called with a `ServerSystemActionContext`, authorization checks are
 * skipped and `creatorId` and `content` are required.
 *
 * Set `createFeedEntry` to `false` to skip sending feed jobs, which is
 * useful for bulk operations like imports.
 */
export async function createDocument(
    context: ServerAccountActionContext,
    {
        id: documentId = generateId<DocumentId>(),
        spaceId,
        creatorId,
        content,
        consistency,
        createFeedEntry = true,
        skipAffinityPointAssignment = false,
        from,
        sitePosition,
    }: {
        id?: DocumentId;
        spaceId: SpaceId;
        creatorId?: AccountId;
        content?: DocumentContent;
        consistency?: DynamoCacheReadConsistency;
        createFeedEntry?: boolean;
        skipAffinityPointAssignment?: boolean;
        from?: DocumentCreatorFrom;
        sitePosition?: {siteId: SiteId; parentId: SiteContainerId; orderKey: OrderKey};
    },
): Promise<{
    id: DocumentId;
    createdTime: Date;
    version: number;
    creator: {id: AccountId; from: DocumentCreatorFrom | null};
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    // If we have an `ImpersonatedAccount` actor we know the "parent" actor is a system
    // actor. Only allow system actors to set the `from` field.
    if (from && context.actor.type !== "ImpersonatedAccount") {
        throw new PermissionDeniedError(
            "Only system actors can specify the \u2018from\u2019 field when creating documents",
        );
    }

    if (
        creatorId &&
        context.actor.type !== "Bot" &&
        creatorId !== context.actor.getPossiblyBotAccountId()
    ) {
        throw new PermissionDeniedError(
            "Only bots can create documents on behalf of other accounts",
        );
    }

    creatorId ??= context.actor.getPossiblyBotAccountId();

    if (!content && context.actor.type === "Bot") {
        // We need a special function for creating documents that were created by bots. A
        // document created by a non-bot always gives manage access to the human that
        // created the document. Bots are different. If we gave access only to account that
        // created the document (the bot) no other users would be able to read the
        // document.
        content = await createEmptyDocumentContentForBot(
            context as ServerMinimalBotActionContext,
            spaceId,
        );
    }

    validateEntityCreationInSiteIfNeeded(content?.attrs.accessPolicy, sitePosition);

    content ??= createEmptyDocumentContent(context.actor.getPossiblyBotAccountId(), sitePosition);

    await authorizeSpaceAccess(context, spaceId);

    const accessPolicy: AccessPolicy = content.attrs.accessPolicy;
    const {resolvedAccessPolicy, transactionEntries} = await validateAccessPolicyUpdateForServer(
        context,
        spaceId,
        `Document:${documentId}`,
        null,
        accessPolicy.type === "Local"
            ? accessPolicy
            : ({
                  ...accessPolicy,
                  position: {
                      orderKey: assertExists(sitePosition?.orderKey),
                      parentId: assertExists(sitePosition?.parentId),
                  },
              } as const),
        {
            consistency,
        },
    );

    const createdTime = new Date();
    const version = 0;

    const newIndexSearchEntityJob: DocumentIndexSearchEntityJob = {
        sendTime: createdTime,
        generation: 0,
        delaySeconds: getDocumentIndexSearchEntityJobDelaySeconds(0),
        updatedTraits: {type: "Any"},
    };

    // Even though we mark this document as hasAddedFeedCandidateEntry if it's shared,
    // imports only create feed entries for the top level item. This avoids a wall of
    // thousands of documents. While hasAddedFeedCandidateEntry: true is not
    // technically the truth, we don't want to recreate the feed entry if a user
    // unshares and reshares an imported document. This means if you import a section
    // of documents as private, and choose to share them publicly later, it WILL create
    // feed entries.
    const hasAddedFeedCandidateEntry = !!resolvedAccessPolicy.defaultGrant;

    const creator = {
        id: creatorId,
        from:
            from ??
            (context.actor.type === "Bot"
                ? {type: "Bot" as const, accountId: context.actor.getBotAccountId()}
                : null),
    };

    await RynamoTableSchema.executeTransaction(context, [
        DocumentsTable.transactionCreateItem({
            partitionType: "Document",
            sortRangeType: "Attributes",
            createdTime,
            spaceId,
            documentId,
            creator,
            version,
            titleWithoutFallback: getDocumentContentTitleWithoutFallback(content),
            accessPolicy,
            lastIndexSearchEntityJob: newIndexSearchEntityJob,
            stepCountByAccountId: new DocumentStepCountByAccountId(new Map()),
            hasAddedFeedCandidateEntry,
            deleted: null,
        }),
        DocumentsTable.transactionCreateOrReplaceItem({
            partitionType: "Document",
            documentId,
            sortRangeType: "Snapshot",
            version,
            content,
        }),
        ...transactionEntries.map(entry => entry.transactionEntry),
    ]);

    if (createFeedEntry) {
        const entry: FeedEntry = {
            type: "Document",
            documentId,
            sharedTime: createdTime,
            sharerId: creatorId,
            creator,
            event: "Created",
        };

        // Immediately add the document to the creator's feed. Whether the document is
        // private or public. If the document is public we will add it to everyone else's
        // feed below. This way the creator can quickly find the document they created
        // again by opening their feed.
        context.process.waitUntil(
            addFeedAccountCandidateEntry(
                // NOTE(calebmer, #2026-03-16): This is an `async` operation that runs after
                // `createDocument()` returns. We don't need to enforce strong read consistency
                // here.
                context.dynamo.unexpectStrongReadConsistency(),
                spaceId,
                creatorId,
                entry,
            ),
        );

        // We wait 5min before adding to the feed so the user has time to type in the
        // document. That way if the user opens their feed they don't see an empty
        // document. Also, we have to wait a bit for the document content preview to be
        // generated anyway or else we'll only have the document's title.
        if (hasAddedFeedCandidateEntry) {
            context.jobs.send(
                {
                    type: "AddFeedCandidateEntry",
                    jobId: generateId(),
                    spaceId,
                    // We already added this document to the creator's feed. Don't add it again.
                    entry: {...entry, excludeFromCreatorFeed: true},
                },
                {delaySeconds: 5 * 60},
            );
        }
    }

    context.jobs.send(
        {
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "Document",
                documentId,
                updatedTraits: newIndexSearchEntityJob.updatedTraits,
            },
        },
        {delaySeconds: newIndexSearchEntityJob.delaySeconds},
    );

    if (!skipAffinityPointAssignment) {
        context.process.waitUntil(
            // Special interaction that adds a bunch more points then normal interactions. So
            // newly created documents are always easily accessible in the search affinity
            // list.
            markSearchAffinityCreateDocumentEntityInteraction(
                // NOTE(ifitzsimmons, #2026-01-30): This is an `async` job that runs after
                // `createDocument()` returns. We don't need to expect strong read consistency
                // here.
                context.dynamo.unexpectStrongReadConsistency(),
                {
                    spaceId,
                    documentId,
                    creatorId,
                    siteId: getSiteIdFromAccessPolicyIfExists(accessPolicy),
                },
            ),
        );
    }

    return {
        id: documentId,
        createdTime,
        version,
        creator,
        getRynamoEventsForSite: async (context: ServerActionContext) =>
            await runAllPromises(transactionEntries?.map(entry => entry.getEvent(context)) ?? []),
    };
}

/**
 * Duplicate a document, optionally replacing template variables with provided
 * values.
 *
 * Template variables are text patterns in the format `{{Variable name}}`. When
 * `values` is provided, these patterns are replaced with the corresponding values.
 */
export async function duplicateDocument(
    context: ServerSessionActionContext,
    {
        sourceDocumentId,
        variableValues,
    }: {
        sourceDocumentId: DocumentId;
        variableValues?: ContentDuplicationVariableValues;
    },
): ReturnType<typeof createDocument> {
    // Load the source document. Use `getDocumentContentWithOptionalComments` so that
    // users with only View access can duplicate documents. Comments are stripped
    // automatically for viewers.
    const {spaceId, content: sourceContentWithComments} =
        await getDocumentContentWithOptionalComments(context, sourceDocumentId);

    // Strip comment marks from the source content (in case the user has Comment access
    // and the content includes comments).
    const sourceContent = assertDocumentContent(
        stripDocumentContentCommentMarks(sourceContentWithComments),
    );

    // Replace template variables if values are provided
    let processedContent = sourceContent;
    if (variableValues && variableValues.size > 0) {
        processedContent = assertDocumentContent(
            applyContentDuplicationVariableValues(sourceContent, variableValues),
        );
    }

    // Build the new document content with the new title and fresh access policy
    const creatorId = context.actor.getAccountId();
    const newAccessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const processedContentTitle = getDocumentContentTitle(processedContent);

    // Generate the new title with "(copy)" suffix but only if the title hasn't
    // changed. If there was a template variable in the title we don't need "(copy)".
    const newTitleText =
        processedContentTitle === getDocumentContentTitle(sourceContent)
            ? generateDuplicateContentTitle(processedContentTitle)
            : processedContentTitle;

    // Create the new title node
    const newTitleNode = DocumentContentProsemirrorSchema.node(
        "title",
        processedContent.child(0).attrs,
        newTitleText ? [DocumentContentProsemirrorSchema.text(newTitleText)] : [],
    );

    const newContentChildren: Array<Node> = [newTitleNode];
    for (let i = 1; i < processedContent.childCount; i++) {
        newContentChildren.push(processedContent.child(i));
    }

    const newContent = assertDocumentContent(
        DocumentContentProsemirrorSchema.node(
            "doc",
            {
                ...processedContent.attrs,
                accessPolicy: newAccessPolicy,
            },
            newContentChildren,
        ),
    );

    // Generate the document ID before creating the document. We need this ID to attach
    // files BEFORE the document exists. This prevents a race condition where a user
    // opens the document before file attachments complete.
    const newDocumentId = generateId<DocumentId>();

    // Extract file IDs from the new content
    const {fileIds} = getContentReferencedIdsForNode(newContent);

    // If there are files to attach, we need to pre-populate the authorization cache so
    // that file attachment authorization succeeds for the not-yet-created document.
    if (fileIds.size > 0) {
        // Attach files from the source document to the new document BEFORE creating the
        // document. This prevents a race condition where a user opens the document before
        // file attachments complete.
        await runAllPromises(
            mapIterable(fileIds, fileId =>
                attachFileFromAttachment(context, fileId, {
                    from: FileDocumentAuthorizer.bind({
                        type: "Document",
                        documentId: sourceDocumentId,
                    }),
                    to: FileDocumentAuthorizer.bind({
                        type: "Document",
                        documentId: newDocumentId,
                    }),

                    // The new document hasn't been created yet. So don't authorize we have access
                    // since doing so will throw a `NotFoundError`. We definitely have access to the
                    // new document since our actor is about to create it.
                    dangerouslySkipToAuthorizeTargetAccess: true,
                }),
            ),
        );
    }

    // Create the new document with the pre-generated ID
    return await createDocument(context, {
        id: newDocumentId,
        spaceId,
        content: newContent,
    });
}

/**
 * Get a preview of the document with the provided id.
 *
 * Cheaper than `getDocument()` since we don't return the full content.
 *
 * The result is cached. If you call this for the same `DocumentId` multiple times
 * in the same action you'll get the same result without issuing a network request.
 *
 * This function is somewhat strongly consistent. If null is returned that means
 * the document does not exist with strong consistency. (Since we retry reading
 * null results with strong consistency.)
 */
export async function getDocumentPreviewIfPossible(
    context: ServerActionContext,
    id: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<Result<DocumentPreviewModel, ErrorBase> | null> {
    const item = await getDocumentItemForAuthorizationIfExists(context, id, options);
    if (!item) return null;

    const result = await authorizeDocumentItemAccessIfPossible(context, item, "View", options);
    if (!result.ok) return result;

    return {
        ok: true,
        value: new DocumentPreviewModel({
            id,
            createdTime: item.createdTime,
            spaceId: item.spaceId,
            version: item.version,
            titleWithoutFallback: item.titleWithoutFallback,
            accessPolicy: item.accessPolicy,
            isDeleted: !!item.deleted,
        }),
    };
}

/**
 * Get a preview of the document with the provided id.
 *
 * Cheaper than `getDocument()` since we don't return the full content.
 *
 * The result is cached. If you call this for the same `DocumentId` multiple times
 * in the same action you'll get the same result without issuing a network request.
 *
 * This function is somewhat strongly consistent. If null is returned that means
 * the document does not exist with strong consistency. (Since we retry reading
 * null results with strong consistency.)
 */
export async function getDocumentPreviewIfExists(
    context: ServerActionContext,
    id: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<DocumentPreviewModel | null> {
    const result = await getDocumentPreviewIfPossible(context, id, options);
    if (!result) return null;
    return unwrapResult(result);
}

/**
 * Get a preview of the document with the provided id.
 *
 * Cheaper than `getDocument()` since we don't return the full content.
 *
 * The result is cached. If you call this for the same `DocumentId` multiple times
 * in the same action you'll get the same result without issuing a network request.
 */
export async function getDocumentPreview(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<DocumentPreviewModel> {
    const document = await getDocumentPreviewIfExists(context, documentId, options);
    if (!document) throw createDocumentNotFoundError(documentId);
    return document;
}

/**
 * Authorizes that the current request can access the document.
 */
export async function authorizeDocumentAccess(
    context: ServerActionContext,
    documentId: DocumentId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<{spaceId: SpaceId; creatorId: AccountId | null; accessPolicy: AccessPolicy}> {
    const documentItem = await getDocumentItemForAuthorization(context, documentId, options);

    await authorizeDocumentItemAccess(context, documentItem, expectedAccessLevel, options);

    return {
        spaceId: documentItem.spaceId,
        creatorId: documentItem.creator.id,
        accessPolicy: documentItem.accessPolicy,
    };
}

/**
 * Authorizes that the current request can access the document.
 *
 * Returns a result instead of throwing an error if authorization fails.
 */
export async function authorizeDocumentAccessIfPossible(
    context: ServerActionContext,
    documentId: DocumentId,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<
    Result<{spaceId: SpaceId; creatorId: AccountId | null; accessPolicy: AccessPolicy}, ErrorBase>
> {
    const documentItem = await getDocumentItemForAuthorization(context, documentId, options);

    const result = await authorizeDocumentItemAccessIfPossible(
        context,
        documentItem,
        expectedAccessLevel,
        options,
    );
    if (!result.ok) return result;

    return {
        ok: true,
        value: {
            spaceId: documentItem.spaceId,
            creatorId: documentItem.creator.id,
            accessPolicy: documentItem.accessPolicy,
        },
    };
}

async function authorizeDocumentItemAccess(
    context: ServerActionContext,
    documentItem: {
        spaceId: SpaceId;
        accessPolicy: AccessPolicy;
        documentId: DocumentId;
        deleted: DocumentAttributesItemDeleted | null;
    },
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<void> {
    unwrapResult(
        await authorizeDocumentItemAccessIfPossible(
            context,
            documentItem,
            expectedAccessLevel,
            options,
        ),
    );
}

async function authorizeDocumentItemAccessIfPossible(
    context: ServerActionContext,
    documentItem: {
        spaceId: SpaceId;
        accessPolicy: AccessPolicy;
        documentId: DocumentId;
        deleted: DocumentAttributesItemDeleted | null;
    },
    expectedAccessLevel: AccessLevel,
    {
        consistency,
        dangerouslyAllowDeleted = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted?: boolean;
    } = {},
): Promise<Result<void, ErrorBase>> {
    if (documentItem.deleted) {
        // If the actor couldn't view the document then use a "permission denied" error to
        // avoid leaking that the document was deleted.
        const result = await authorizeDocumentItemAccessAllowingDeletedIfPossible(
            context,
            documentItem,
            "View",
            {consistency},
        );
        if (!result.ok) return result;

        const hasDeletedAccess = await evaluateDeletedAccess(context, {
            spaceId: documentItem.spaceId,
            expectedAccessLevel,
            dangerouslyAllowDeleted,
        });

        if (!hasDeletedAccess) {
            return {
                ok: false,
                // NOTE(calebmer):Using `ErrorCode.NotFound` is important here. Consumers of this
                // error will render not found errors as "Deleted" and `ErrorCode.PermissionDenied`
                // as "Private".
                error: new NotFoundError("Document was deleted", {
                    aggregateDedupeKey: documentItem.documentId,
                    displayMessage: documentDeletedErrorDisplayMessage,
                }),
            };
        }
    }

    return await authorizeDocumentItemAccessAllowingDeletedIfPossible(
        context,
        documentItem,
        expectedAccessLevel,
        {consistency},
    );
}

async function authorizeDocumentItemAccessAllowingDeletedIfPossible(
    context: ServerActionContext,
    documentItem: {
        spaceId: SpaceId;
        accessPolicy: AccessPolicy;
        documentId: DocumentId;
    },
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Result<void, ErrorBase>> {
    // Evaluate the document access policy.
    const isAccessAuthorized = await evaluateAccessPolicy(
        context,
        documentItem.spaceId,
        documentItem.accessPolicy,
        expectedAccessLevel,
        options,
    );

    if (isAccessAuthorized) return okResult;

    return {
        ok: false,
        error: await createAccessPolicyPermissionDeniedError(context, {
            spaceId: documentItem.spaceId,
            expectedAccessLevel,
            displayMessages: documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel,
        }),
    };
}

const DocumentItemAuthorizationCache = new DynamoContextCache<
    DocumentId,
    DocumentAttributesItem | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getDocumentItemForAuthorization(
    context: Context<
        DynamoContextModules & {
            actor: ActorContextModule;
            cache: CacheContextModule;
        }
    >,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<DocumentAttributesItem> {
    const item = await getDocumentItemForAuthorizationIfExists(context, documentId, options);
    if (!item) throw createDocumentNotFoundError(documentId);
    return item;
}

async function getDocumentItemForAuthorizationIfExists(
    context: Context<
        DynamoContextModules & {
            actor: ActorContextModule;
            cache: CacheContextModule;
        }
    >,
    documentId: DocumentId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<DocumentAttributesItem | null> {
    return await DocumentItemAuthorizationCache.get(context, consistency, documentId, consistency =>
        DocumentsTable.getItemIfExists(
            context,
            {
                partitionType: "Document",
                sortRangeType: "Attributes",
                documentId,
            },
            {consistency},
        ),
    );
}

/**
 * Check if a document with the given ID exists.
 *
 * This function bypasses authorization checks and is intended for system
 * operations like imports where we need to check if a document already exists
 * before creating it.
 */
export async function doesDocumentExist(
    context: Context<
        DynamoContextModules & {
            actor: SystemActorContextModule;
            cache: CacheContextModule;
        }
    >,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<boolean> {
    context.actor.authorizeSystem();
    const item = await getDocumentItemForAuthorizationIfExists(context, documentId, options);
    return !!item;
}

type InternalDocument = {
    readonly attributes: DocumentAttributesItem;
    readonly stepTransactionsAfterSnapshot: ReadonlyArray<DocumentStepTransactionAfterSnapshotItem>;
    readonly snapshot: DocumentSnapshotItem;
    readonly version: number;
    readonly content: DocumentContent;
};

export const getInternalDocumentTestCounter = new TestCounter();

async function getInternalDocumentIfExists(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {
        // If true then you can read the document content with the "View" access level but
        // comments will be stripped from the document's content. Similar to
        // `getDocumentWithOptionalComments()`.
        withOptionalComments?: boolean;

        // Allow reading a document's comment marks even if the actor only has the "View"
        // access level but only if the actor is coming from
        // `DocumentCollaborationService`.
        forCollaborationServiceInitialization?: boolean;

        // Allow reading the document content with strong consistency.
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<InternalDocument | null> {
    const result = await getInternalDocumentIfPossible(context, documentId, options);
    if (result === null) return null;
    return unwrapResult(result);
}

async function getInternalDocumentIfPossible(
    context: ServerActionContext,
    documentId: DocumentId,
    {
        dangerouslyAllowDeleted = false,
        withOptionalComments = false,
        forCollaborationServiceInitialization = false,
        consistency = "Eventual",
    }: {
        // If true then deleted document content can be read after authorizing "View"
        // access. This returns the persisted content as-is.
        dangerouslyAllowDeleted?: boolean;

        // If true then you can read the document content with the "View" access level but
        // comments will be stripped from the document's content. Similar to
        // `getDocumentWithOptionalComments()`.
        withOptionalComments?: boolean;

        // Allow reading a document's comment marks even if the actor only has the "View"
        // access level but only if the actor is coming from
        // `DocumentCollaborationService`.
        forCollaborationServiceInitialization?: boolean;

        // Allow reading the document content with strong consistency.
        consistency?: DynamoCacheReadConsistency;
    } = {},
): Promise<Result<InternalDocument, ErrorBase> | null> {
    getInternalDocumentTestCounter.incrementForTest(documentId);

    let attributes: DocumentAttributesItem | null = null;
    let isCommentAccessAuthorized = false;
    let stepTransactionsAfterSnapshot: Array<DocumentStepTransactionAfterSnapshotItem> = [];
    let maybeSnapshot: DocumentSnapshotItem | null = null;

    for await (const item of DocumentsTable.query(context, {
        partitionKey: {
            partitionType: "Document",
            documentId,
        },
        startSortKey: {
            sortRangeType: "Attributes",
        },
        endSortKey: {
            sortRangeType: "Snapshot",
        },
        limit: "All",
        // NOTE(calebmer): An optimization may be to do a strong read on the `Attributes`
        // item and if it disagrees with our eventually consistent read then do a strongly
        // consistent read of missing steps. That way the entire query doesn't need to be
        // strongly consistent.
        consistency,
    })) {
        switch (item.sortRangeType) {
            case "Attributes": {
                attributes = item;

                // Save the document attributes item to our context cache so if
                // `authorizeDocumentAccess()` is called afterwards (e.g. when reading content
                // references) the document preview is already available and can be used to
                // authorize.
                DocumentItemAuthorizationCache.set(context, consistency, documentId, item);

                // Must have view access level to read the document.
                const viewAuthorizationResult = await authorizeDocumentItemAccessIfPossible(
                    context,
                    item,
                    "View",
                    {consistency, dangerouslyAllowDeleted},
                );

                if (!viewAuthorizationResult.ok) {
                    return viewAuthorizationResult;
                }

                if (attributes.deleted && dangerouslyAllowDeleted) {
                    isCommentAccessAuthorized = true;
                    break;
                }

                const commentAuthorizationResult = await authorizeDocumentItemAccessIfPossible(
                    context,
                    attributes,
                    "Comment",
                    {consistency},
                );

                if (!commentAuthorizationResult.ok) {
                    if (
                        forCollaborationServiceInitialization &&
                        context.actor.serviceName === "DocumentCollaborationService"
                    ) {
                        // Dangerous privilege escalation! If we're initializing the document collaboration
                        // service then allow reading comments even if the actor initializing the
                        // collaboration service is a viewer. We trust the collaboration service to
                        // implement its own permission checks to make sure viewers can't see comment marks
                        // in document content.
                        isCommentAccessAuthorized = true;
                    } else if (!withOptionalComments) {
                        return commentAuthorizationResult;
                    }
                } else {
                    isCommentAccessAuthorized = true;
                }
                break;
            }
            case "StepTransactionsAfterSnapshot": {
                stepTransactionsAfterSnapshot.push(item);
                break;
            }
            case "Snapshot": {
                maybeSnapshot = item;
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (attributes === null) {
        assert(
            !maybeSnapshot && stepTransactionsAfterSnapshot.length === 0,
            "Document with no attributes should not have snapshot",
        );
        return null;
    }

    if (!maybeSnapshot)
        throw new DataLossError("Document with attributes should also have a snapshot");
    const snapshot = maybeSnapshot;

    if (snapshot.version > attributes.version)
        throw new DataLossError("Document snapshot version is ahead of version attribute");

    // If we have some steps before the snapshot in `stepTransactionsAfterSnapshot`,
    // that's fine. We may be in the middle of moving steps into the
    // `StepTransactionsBeforeSnapshot` sort range.
    //
    // Drop any steps before the snapshot.
    stepTransactionsAfterSnapshot = stepTransactionsAfterSnapshot.filter(stepTransaction => {
        if (stepTransaction.startVersion < snapshot.version) {
            // We assume step transactions are applied to the snapshot atomically. We don't
            // support some steps in a transaction being before the snapshot and some steps in
            // a transaction being after the snapshot. It's all or nothing for now.
            if (stepTransaction.startVersion + stepTransaction.steps.length > snapshot.version)
                throw new DataLossError(
                    "Document snapshot version is in the middle of a step transaction",
                );

            return false;
        }

        return true;
    });

    let version = snapshot.version;
    let content = snapshot.content;

    for (const stepTransaction of stepTransactionsAfterSnapshot) {
        if (stepTransaction.startVersion !== version)
            throw new DataLossError(
                "Mismatched document snapshot version and step transaction version",
            );

        for (const step of stepTransaction.steps) {
            const stepResult = step.apply(content);
            if (!stepResult.doc)
                throw new DataLossError(
                    `Step after document snapshot could not be applied: ${stepResult.failed!}`,
                );

            assert(isDocumentContent(stepResult.doc));
            content = stepResult.doc;
        }

        version += stepTransaction.steps.length;
    }

    return {
        ok: true,
        value: {
            attributes,
            stepTransactionsAfterSnapshot,
            snapshot,
            version,
            // If you're not allowed to read comments then strip comment marks from the
            // document.
            content: !isCommentAccessAuthorized
                ? assertDocumentContent(stripDocumentContentCommentMarks(content))
                : content,
        },
    };
}

/**
 * Get the full document with the provided id. Throw an error if it doesn't exist.
 *
 * This requires the "Comment" access level. Will throw an error if the actor only
 * has the "View" access level. Use `getDocumentWithOptionalComments()` if you want
 * a `DocumentModel` even when the access level is "View".
 */
export async function getDocument(
    context: ServerActionContext,
    documentId: DocumentId,
): Promise<DocumentModel> {
    return (
        await getDocumentWithOptionalCommentsAndCommentThreads(context, {
            documentId,
            // Setting this to something other than undefined forces this function to throw a
            // `PermissionDeniedError` if the actor doesn't have comment access.
            commentThreadIds: [],
        })
    ).document;
}

/**
 * Get the full document with the provided id. Throw an error if it doesn't exist.
 *
 * If the actor has view access to the document but not comment access then we'll
 * return a document with no comment thread references and all comment marks
 * stripped instead of throwing an error.
 */
export async function getDocumentWithOptionalComments(
    context: ServerActionContext,
    documentId: DocumentId,
): Promise<DocumentModel> {
    return (await getDocumentWithOptionalCommentsAndCommentThreads(context, {documentId})).document;
}

/**
 * Get the full document with the provided id. Return null if it doesn't exist.
 *
 * If the actor has view access to the document but not comment access then we'll
 * return a document with no comment thread references and all comment marks
 * stripped instead of throwing an error.
 */
export async function getDocumentWithOptionalCommentsIfExists(
    context: ServerActionContext,
    documentId: DocumentId,
    options: {
        onSiteId?: (siteId: SiteId) => void;
    } = {},
): Promise<DocumentModel | null> {
    return (
        (
            await getDocumentWithOptionalCommentsAndCommentThreadsIfExists(context, {
                documentId,
                onSiteId: options.onSiteId,
            })
        )?.document ?? null
    );
}

/**
 * Get the document with the provided id and all the requested comment threads.
 *
 * The returned document model includes all referenced comment threads already, so
 * if you request any archived comment threads they are returned out of band in the
 * `commentThreads` array.
 *
 * If the actor has view access to the document but doesn't have comment access
 * then we don't return any comment data and strip the document content of all
 * comment marks. If `commentThreadIds` is set to something other than `undefined`
 * then we'll throw an error if the user doesn't have comment access instead of
 * silently stripping all comment data from the result.
 */
async function getDocumentWithOptionalCommentsAndCommentThreads(
    context: ServerActionContext,
    options: {
        documentId: DocumentId;
        // Allow `commentThreadIds` to be a promise so we can execute document loading in
        // parallel with code that loads which `commentThreadIds`.
        commentThreadIds?: MaybePromise<Iterable<DocumentCommentThreadId>>;
        // If you pass this in, we will call once we've loaded the `SpaceId` for the
        // document which may be before the function as a whole returns. This function will
        // not be called in error cases.
        onSpaceId?: (spaceId: SpaceId) => void;
    },
): Promise<{
    document: DocumentModel;
    commentThreads: ReadonlyArray<DocumentCommentThreadModel>;
}> {
    const result = await getDocumentWithOptionalCommentsAndCommentThreadsIfExists(context, options);
    if (!result) throw createDocumentNotFoundError(options.documentId);
    return result;
}

async function getDocumentWithOptionalCommentsAndCommentThreadsIfExists(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds: requestedCommentThreadIdsPromise,
        onSpaceId,
        onSiteId,
    }: {
        documentId: DocumentId;
        // Allow `commentThreadIds` to be a promise so we can execute document loading in
        // parallel with code that loads which `commentThreadIds`.
        commentThreadIds?: MaybePromise<Iterable<DocumentCommentThreadId>>;
        // If you pass this in, we will call once we've loaded the `SpaceId` for the
        // document which may be before the function as a whole returns. This function will
        // not be called in error cases.
        onSpaceId?: (spaceId: SpaceId) => void;
        onSiteId?: (siteId: SiteId) => void;
    },
): Promise<{
    document: DocumentModel;
    commentThreads: ReadonlyArray<DocumentCommentThreadModel>;
} | null> {
    let maybeAttributes: DocumentAttributesItem | null = null;
    let maybeCommentAuthorizationResult: Result<void, ErrorBase> | null = null;
    let stepTransactionsAfterSnapshot: Array<DocumentStepTransactionAfterSnapshotItem> = [];
    let maybeSnapshot: DocumentSnapshotItem | null = null;
    const staleReferencedCommentThreadById = new Map<
        DocumentCommentThreadId,
        DocumentReferencedCommentThreadItem
    >();

    const queryConsistency: DynamoReadConsistency = "Eventual";

    for await (const item of DocumentsTable.query(context, {
        limit: "All",
        consistency: queryConsistency,
        partitionKey: {
            partitionType: "Document",
            documentId,
        },
        startSortKey: {
            sortRangeType: "Attributes",
        },
        endSortKey: {
            sortRangeType: "ReferencedCommentThread",
            commentThreadId: getMaxId<DocumentCommentThreadId>(),
        },
    })) {
        // If we've found the snapshot item and the user doesn't have comment access then
        // stop looping. We don't want to read comment thread items since the user doesn't
        // have access to them anyway.
        if (
            maybeSnapshot !== null &&
            maybeCommentAuthorizationResult !== null &&
            !maybeCommentAuthorizationResult.ok
        ) {
            break;
        }

        switch (item.sortRangeType) {
            case "Attributes": {
                maybeAttributes = item;
                onSpaceId?.(item.spaceId);

                if (item.accessPolicy.type === "Site") {
                    onSiteId?.(item.accessPolicy.siteId);
                }

                // Save the document attributes item to our context cache so if
                // `authorizeDocumentAccess()` is called afterwards (e.g. when reading content
                // references) the document preview is already available and can be used to
                // authorize.
                DocumentItemAuthorizationCache.set(context, queryConsistency, documentId, item);

                // Must have the view access level to read a document.
                await authorizeDocumentItemAccess(context, item, "View");

                // We'll only return comment threads from this function if the actor is allowed to
                // read comments.
                maybeCommentAuthorizationResult = await authorizeDocumentItemAccessIfPossible(
                    context,
                    item,
                    "Comment",
                );

                // Throw an error if we requested to load some comment thread IDs and the user
                // doesn't have comment access. This option must be undefined if the user only has
                // view access.
                if (requestedCommentThreadIdsPromise && !maybeCommentAuthorizationResult.ok) {
                    throw maybeCommentAuthorizationResult.error;
                }
                break;
            }
            case "StepTransactionsAfterSnapshot": {
                stepTransactionsAfterSnapshot.push(item);
                break;
            }
            case "Snapshot": {
                maybeSnapshot = item;
                break;
            }
            case "ReferencedCommentThread": {
                staleReferencedCommentThreadById.set(item.commentThreadId, item);
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (maybeAttributes === null || maybeCommentAuthorizationResult === null) {
        assert(
            !maybeSnapshot &&
                stepTransactionsAfterSnapshot.length === 0 &&
                staleReferencedCommentThreadById.size === 0,
            "Document with no attributes should not have snapshot",
        );
        return null;
    }
    const attributes = maybeAttributes;
    const commentAuthorizationResult = maybeCommentAuthorizationResult;

    if (!maybeSnapshot)
        throw new DataLossError("Document with attributes should also have a snapshot");
    const snapshot = maybeSnapshot;

    if (snapshot.version > attributes.version)
        throw new DataLossError("Document snapshot version is ahead of version attribute");

    // If we have some steps before the snapshot in `stepTransactionsAfterSnapshot`,
    // that's fine. We may be in the middle of moving steps into the
    // `StepTransactionsBeforeSnapshot` sort range.
    //
    // Drop any steps before the snapshot.
    stepTransactionsAfterSnapshot = stepTransactionsAfterSnapshot.filter(stepTransaction => {
        if (stepTransaction.startVersion < snapshot.version) {
            // We assume step transactions are applied to the snapshot atomically. We don't
            // support some steps in a transaction being before the snapshot and some steps in
            // a transaction being after the snapshot. It's all or nothing for now.
            if (stepTransaction.startVersion + stepTransaction.steps.length > snapshot.version)
                throw new DataLossError(
                    "Document snapshot version is in the middle of a step transaction",
                );

            return false;
        }

        return true;
    });

    let version = snapshot.version;
    let content = snapshot.content;

    for (const stepTransaction of stepTransactionsAfterSnapshot) {
        if (stepTransaction.startVersion !== version)
            throw new DataLossError(
                "Mismatched document snapshot version and step transaction version",
            );

        for (const step of stepTransaction.steps) {
            const stepResult = step.apply(content);
            if (!stepResult.doc)
                throw new DataLossError(
                    `Step after document snapshot could not be applied: ${stepResult.failed!}`,
                );

            assert(isDocumentContent(stepResult.doc));
            content = stepResult.doc;
        }

        version += stepTransaction.steps.length;
    }

    const referencedCommentThreadIds = commentAuthorizationResult.ok
        ? getReferencedDocumentCommentThreadIds(content)
        : emptySet;

    const getCommentThread = async (
        commentThreadId: DocumentCommentThreadId,
    ): Promise<[DocumentCommentThreadId, DocumentCommentThreadItem] | null> => {
        const commentThread =
            staleReferencedCommentThreadById.get(commentThreadId) ??
            // If our query didn't find the comment thread, it must be because our snapshot
            // update process hasn't moved it from the archive range back into the referenced
            // range. Try reading it from the archive range. Eventually the comment thread
            // should be in our referenced range.
            (await getDocumentCommentThreadItemIfExists(context, {
                documentId,
                commentThreadId,
                // Try reading from the archive range first because we already queried the entire
                // referenced comment thread range.
                shouldTryArchiveFirst: true,
            }));

        if (!commentThread) return null;

        return [commentThread.commentThreadId, commentThread];
    };

    // Fetch the site if the document's access policy is a Site type.
    const accessPolicy = content.attrs.accessPolicy;
    const siteId = accessPolicy.type === "Site" ? accessPolicy.siteId : null;

    const [
        contentReferences,
        referencedCommentThreadById,
        {requestedCommentThreadIds, archivedCommentThreadById},
        siteById,
    ] = await runAllPromises([
        getContentReferencesAssumingViewAccessWithOptionalSpaceAccess(
            context,
            attributes.spaceId,
            FileDocumentAuthorizer.bind({type: "Document", documentId}),
            content,
            // Preload small files so we don't have to show a placeholder for them. This
            // improves UX at the cost slowing the initial load. Right now we preload <100kb
            // files up to 400kb. We'll have to tune this to find the right balance between UX
            // and the performance hit.
            {withPreloadedFiles: true},
        ),
        runAllPromises(mapIterable(referencedCommentThreadIds, getCommentThread)).then(
            commentThreadById => new Map(filterIterable(commentThreadById, isNonNullable)),
        ),
        (async () => {
            const requestedCommentThreadIds =
                (await requestedCommentThreadIdsPromise) ?? emptyArray;

            // All the requested comment threads that aren't part of the referenced comment
            // thread set we're already loading.
            const archivedCommentThreadIds = new Set(
                filterIterable(
                    requestedCommentThreadIds ?? emptyArray,
                    commentThreadId => !referencedCommentThreadIds.has(commentThreadId),
                ),
            );

            const archivedCommentThreadById = await runAllPromises(
                mapIterable(archivedCommentThreadIds, getCommentThread),
            ).then(commentThreadById => new Map(filterIterable(commentThreadById, isNonNullable)));

            return {
                requestedCommentThreadIds,
                archivedCommentThreadById,
            };
        })(),
        siteId
            ? context.sitesInjection.getSitePreview(siteId).then(site => new Map([[siteId, site]]))
            : new Map(),
    ]);

    const [actualReferencedCommentThreadById, actualRequestedCommentThreads] = await runAllPromises(
        [
            runAllPromises(
                mapIterable(
                    referencedCommentThreadById,
                    async ([commentThreadId, commentThread]) => {
                        return [
                            commentThreadId,
                            await createDocumentCommentThreadReferenceFromItem(
                                context,
                                attributes.spaceId,
                                commentThread,
                            ),
                        ] as const;
                    },
                ),
            ),
            runAllPromises(
                mapIterable(requestedCommentThreadIds, commentThreadId => {
                    const commentThread =
                        referencedCommentThreadById.get(commentThreadId) ??
                        archivedCommentThreadById.get(commentThreadId);

                    if (!commentThread)
                        throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

                    return createDocumentCommentThreadModelFromItem(
                        context,
                        attributes.spaceId,
                        commentThread,
                    );
                }),
            ),
        ],
    );

    // Extra security: Double check that if the user doesn't have comment access then
    // we haven't loaded any comment threads. We should have already stopped any
    // comment threads from loading at this point in the function but we double check
    // with asserts to be safe.
    if (!commentAuthorizationResult.ok) {
        assert(referencedCommentThreadById.size === 0);
        assert(archivedCommentThreadById.size === 0);
        assert(actualReferencedCommentThreadById.length === 0);
        assert(actualRequestedCommentThreads.length === 0);
    }

    return {
        document: new DocumentModel({
            id: documentId,
            createdTime: attributes.createdTime,
            spaceId: attributes.spaceId,
            version: attributes.version,
            creator: {from: attributes.creator.from},
            content: {
                // If the user doesn't have comment access then we need to strip all comment marks
                // from the document's content. Since it's a security policy violation if the user
                // can inspect the DOM and see ranges of text with comments even if the user can't
                // read the comment. The mere presence of a comment on a range of text may tell the
                // user something they're not allowed to know.
                doc: commentAuthorizationResult.ok
                    ? content
                    : assertDocumentContent(stripDocumentContentCommentMarks(content)),
                references: {
                    ...contentReferences,
                    // Extra security: Absolutely make sure we don't return comment threads if the user
                    // doesn't have comment access.
                    commentThreadById: commentAuthorizationResult.ok
                        ? new Map(actualReferencedCommentThreadById)
                        : emptyMap,
                    siteById,
                },
            },
        }),
        // Extra security: Absolutely make sure we don't return comment threads if the user
        // doesn't have comment access.
        commentThreads: commentAuthorizationResult.ok ? actualRequestedCommentThreads : emptyArray,
    };
}

/**
 * Get only the document's title and access policy. Very fast since this does not
 * load the document's full content.
 */
export async function getDocumentTitleIfExists(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency; dangerouslyAllowDeleted?: boolean},
): Promise<{title: string; accessPolicy: AccessPolicy; isDeleted: boolean} | null> {
    const documentPreview = await getDocumentPreviewIfExists(context, documentId, options);
    if (!documentPreview) return null;
    return {
        title: documentPreview.getTitle(),
        accessPolicy: documentPreview.accessPolicy,
        isDeleted: documentPreview.isDeleted,
    };
}

/**
 * Get only the document's content. Does not load any references or comment threads
 * or anything else needed to construct a full `DocumentModel`.
 */
export async function getDocumentContent(
    context: ServerActionContext,
    documentId: DocumentId,
    {
        consistency,
        dangerouslyAllowDeleted = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        dangerouslyAllowDeleted?: boolean;
    } = emptyObject,
): Promise<{
    spaceId: SpaceId;
    createdTime: Date;
    deleted: DocumentAttributesItemDeleted | null;
    version: number;
    content: DocumentContent;
    creator: {id: AccountId | null; from: DocumentCreatorFrom | null};
    stepCountByNonCreatorAccountId: DocumentStepCountByAccountId;
    updateContentPreview: (context: ServerActionContext) => Promise<void>;
}> {
    const internalDocumentResult = await getInternalDocumentIfPossible(context, documentId, {
        consistency,
        dangerouslyAllowDeleted,
    });

    if (!internalDocumentResult) {
        throw createDocumentNotFoundError(documentId);
    }

    const internalDocument = unwrapResult(internalDocumentResult);

    return {
        spaceId: internalDocument.attributes.spaceId,
        createdTime: internalDocument.attributes.createdTime,
        deleted: internalDocument.attributes.deleted,
        version: internalDocument.version,
        content: internalDocument.content,
        creator: {
            id: internalDocument.attributes.creator.id,
            from: internalDocument.attributes.creator.from,
        },
        // It doesn't violate our permission policy for documents to return this. Since
        // commenters can call `getDocumentContentSteps()` and manually compute for
        // themselves how many steps each account left.
        //
        // We don't return this from `getDocumentContentWithOptionalComments()` because
        // currently viewers can't call `getDocumentContentSteps()`. Because historical
        // steps might include comment marks. We might allow viewers to call this function
        // in the future.
        stepCountByNonCreatorAccountId: internalDocument.attributes.stepCountByAccountId,

        updateContentPreview: context =>
            updateDocumentContentPreviewAfterGetDocumentContent(context, {
                documentId,
                version: internalDocument.version,
                content: internalDocument.content,
                dangerouslyAllowDeleted,
            }),
    };
}

function getDocumentContentPreviewSnippet(content: DocumentContent): DocumentContent {
    // We want enough lines that we can render a letter-sized paper preview for
    // documents. See [this task][1] for images of the documents we used to figure out
    // how many lines of text fill a letter sized paper. We count 37 lines then we add
    // 1 for safety giving us 38 lines.
    //
    // [1]:
    //     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/bbw1j3ecf5s7fxrhsfjhthkeg0
    return assertDocumentContent(
        getContentSnippet(content.resolve(0), {linesAbove: 0, linesBelow: 38}),
    );
}

async function updateDocumentContentPreviewAfterGetDocumentContent(
    context: ServerActionContext,
    {
        documentId,
        version,
        content,
        dangerouslyAllowDeleted,
    }: {
        documentId: DocumentId;
        version: number;
        content: DocumentContent;
        dangerouslyAllowDeleted: boolean;
    },
) {
    // Double check the new context has document access. We don't authorize that
    // `version` or `content` match what's in the document because we know `version`
    // and `content` come from `getDocumentContent()`.
    await authorizeDocumentAccess(context, documentId, "View", {dangerouslyAllowDeleted});

    const contentSnippet = getDocumentContentPreviewSnippet(content);

    await DocumentsTable.updateItem(
        context,
        {
            partitionType: "Document",
            sortRangeType: "ContentPreview",
            documentId,
        },
        item => {
            // If the content preview is from a later version then noop.
            if (item && item.version >= version) return item;

            // Optimization: If the existing content preview is the same as the new content
            // preview then noop.
            //
            // There is a race condition bug here:
            //
            // 1. Document is at version `n`
            // 2. Document is updated to version `n + 1` which has different `contentSnippet`
            //    than version `n`
            // 3. Document is updated to version `n + 2` which has the same `contentSnippet` as
            //    version `n`
            // 4. We run this content preview update for version `n + 2` _before_ version
            //    `n + 1` so we skip updating `version` because `contentSnippet` is the same
            // 5. Now we run this content preview update for version `n + 1` which updates
            //    `version` and `contentSnippet`
            //
            // Now we have a stale content preview version!
            //
            // We don't expect this to be a big issue in practice since we only run
            // `IndexSearchEntity` for the document every 10 seconds minimum. Since updates are
            // spaced apart by 10-60 seconds, race conditions shouldn't be an issue in
            // practice.
            //
            // Even if this race condition were to occur and we have stale data in
            // `contentSnippet`, likely the reason for the stale data is the user added a bit
            // of text then immediately deleted it (or deleted a bit of text then immediately
            // re-added it). Given the difference between the actual doc and the stale doc is
            // likely fairly minor in practice we further don't mind this race condition.
            //
            // We expect this to be a meaningful optimization for large, frequently updated,
            // documents. Since we don't need to pay write capacity units to update the content
            // on every document change. So we accept this potentially benign race condition
            // bug. In the future, we could choose to remove this optimization if we find the
            // write cost acceptable to fix race condition bugs we're seeing.
            if (item && item.content.eq(contentSnippet)) return item;

            return {
                partitionType: "Document",
                sortRangeType: "ContentPreview",
                documentId,
                version,
                content: contentSnippet,
            };
        },
    );
}

/**
 * Gets a content preview for the document. If the document doesn't exist then we
 * return null. If we haven't generated the content preview for the document yet we
 * also return null. If you don't have access to the document we return a result
 * with `ok: false`.
 *
 * The content preview is cheaper to load than the full document (with
 * `getDocument()` or `getDocumentContent()`) and more expensive to load than the
 * document preview which only contains the title (with `getDocumentPreview()`).
 * However, the tradeoff is the content preview will be 10-60 seconds stale. We
 * only update the content preview every 10-60 seconds as a part of the
 * `IndexSearchEntity` job.
 *
 * This function is useful for rendering a preview of the document in other parts
 * of the product. e.g. When hovering over a document mention or in a file preview.
 *
 * We strip comment marks from the content preview since they aren't interesting in
 * a preview. Also, if you only have view access to the document you aren't allowed
 * to see comment marks anyway.
 */
export async function getDocumentContentPreviewIfPossible(
    context: ServerActionContext,
    documentId: DocumentId,
    {
        consistency = "Eventual",
        onSiteId,
    }: {
        consistency?: DynamoCacheReadConsistency;
        onSiteId?: (siteId: SiteId) => void;
    } = emptyObject,
): Promise<Result<
    {
        version: number;
        titleWithoutFallback: string;
        preview: {
            version: number;
            content: DocumentContentWithReferences;
        };
    },
    ErrorBase
> | null> {
    const itemsPromise = (async () => {
        const items = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                limit: 2,
                consistency,
                partitionKey: {
                    partitionType: "Document",
                    documentId,
                },
                startSortKey: {sortRangeType: "ContentPreview"},
                endSortKey: {sortRangeType: "Attributes"},
            }),
        );

        const attributesItem = findMapIterable(items, item =>
            item.sortRangeType === "Attributes" ? item : undefined,
        );

        const contentPreviewItem = findMapIterable(items, item =>
            item.sortRangeType === "ContentPreview" ? item : undefined,
        );

        return {attributesItem, contentPreviewItem};
    })();

    // Save the document attributes item to our context cache so if
    // `authorizeDocumentAccess()` is called afterwards (e.g. when reading content
    // references) the document preview is already available and can be used to
    // authorize.
    DocumentItemAuthorizationCache.set(
        context,
        consistency,
        documentId,
        itemsPromise.then(({attributesItem}) => attributesItem ?? null),
    );

    const {attributesItem, contentPreviewItem} = await itemsPromise;
    if (!attributesItem) return null;

    if (attributesItem.accessPolicy.type === "Site") {
        onSiteId?.(attributesItem.accessPolicy.siteId);
    }

    // Must have the view access level to read a document.
    const result = await authorizeDocumentItemAccessIfPossible(context, attributesItem, "View");
    if (!result.ok) return result;

    let contentSnippetVersion: number;
    let contentSnippet: DocumentContent;

    if (contentPreviewItem) {
        contentSnippetVersion = contentPreviewItem.version;
        contentSnippet = contentPreviewItem.content;
    } else {
        // If there is no content preview item (because the first `IndexSearchEntity`
        // hasn't run yet) then we fallback to reading the full document.
        const document = await getInternalDocumentIfExists(context, documentId, {
            consistency,
            // We always strip comments. Allow viewers to read this content.
            withOptionalComments: true,
        });

        // We know the document exists because we found its attributes earlier.
        assert(document);

        contentSnippetVersion = document.version;
        contentSnippet = getDocumentContentPreviewSnippet(document.content);
    }

    // Remove comment marks from document preview. Since actor may only have the `View`
    // permission level. But also since comment marks in a preview are distracting. We
    // want the preview to be focused on the content. Must open the document to see
    // comments.
    contentSnippet = assertDocumentContent(stripDocumentContentCommentMarks(contentSnippet));

    return {
        ok: true,
        value: {
            version: attributesItem.version,
            titleWithoutFallback: attributesItem.titleWithoutFallback,
            preview: {
                version: contentSnippetVersion,
                content: {
                    doc: contentSnippet,
                    references: {
                        ...(await getContentReferencesForNode(
                            context,
                            attributesItem.spaceId,
                            FileDocumentAuthorizer.bind({type: "Document", documentId}),
                            contentSnippet,
                        )),
                        commentThreadById: emptyMap,
                        // Content previews don't need sites - they're used for search indexing and
                        // previews where the full access policy isn't needed.
                        siteById: emptyMap,
                    },
                },
            },
        },
    };
}

/**
 * Gets a content preview for the document. If the document doesn't exist then we
 * return null. If we haven't generated the content preview for the document yet we
 * also return null. If you don't have access to the document we throw an error.
 *
 * The content preview is cheaper to load than the full document (with
 * `getDocument()` or `getDocumentContent()`) and more expensive to load than the
 * document preview which only contains the title (with `getDocumentPreview()`).
 * However, the tradeoff is the content preview will be 10-60 seconds stale. We
 * only update the content preview every 10-60 seconds as a part of the
 * `IndexSearchEntity` job.
 *
 * This function is useful for rendering a preview of the document in other parts
 * of the product. e.g. When hovering over a document mention or in a file preview.
 *
 * We strip comment marks from the content preview since they aren't interesting in
 * a preview. Also, if you only have view access to the document you aren't allowed
 * to see comment marks anyway.
 */
export async function getDocumentContentPreviewIfExists(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{
    version: number;
    titleWithoutFallback: string;
    preview: {
        version: number;
        content: DocumentContentWithReferences;
    };
} | null> {
    const result = await getDocumentContentPreviewIfPossible(context, documentId, options);
    if (result === null) return null;
    return unwrapResult(result);
}

/**
 * Get only the document's content. Does not load any references or comment threads
 * or anything else needed to construct a full `DocumentModel`.
 *
 * If the actor has view access to the document but not comment access then we'll
 * return a document with no comment thread references and all comment marks
 * stripped instead of throwing an error.
 */
export async function getDocumentContentWithOptionalComments(
    context: ServerActionContext,
    documentId: DocumentId,
    {consistency}: {consistency?: DynamoReadConsistency} = emptyObject,
): Promise<{
    spaceId: SpaceId;
    createdTime: Date;
    version: number;
    content: DocumentContent;
    creatorId: AccountId | null;
}> {
    const internalDocument = await getInternalDocumentIfExists(context, documentId, {
        consistency,
        withOptionalComments: true,
    });
    if (!internalDocument) throw createDocumentNotFoundError(documentId);

    return {
        spaceId: internalDocument.attributes.spaceId,
        createdTime: internalDocument.attributes.createdTime,
        version: internalDocument.version,
        content: internalDocument.content,
        creatorId: internalDocument.attributes.creator.id,
    };
}

/**
 * Get only the document's content. Does not load any references or comment threads
 * or anything else needed to construct a full `DocumentModel`.
 *
 * If an actor from `DocumentCollaborationService` is calling this function then
 * we'll return comments in the document content even if the actor only has the
 * "View" access level. We trust the document collaboration service to make sure
 * viewers can't see comment marks in a document.
 */
export async function getDocumentContentForCollaborationServiceInitialization(
    context: ServerActionContext,
    documentId: DocumentId,
    {consistency}: {consistency?: DynamoReadConsistency} = emptyObject,
): Promise<{
    spaceId: SpaceId;
    createdTime: Date;
    version: number;
    content: DocumentContent;
    creatorId: AccountId | null;
}> {
    const internalDocument = await getInternalDocumentIfExists(context, documentId, {
        consistency,
        forCollaborationServiceInitialization: true,
    });
    if (!internalDocument) throw createDocumentNotFoundError(documentId);

    return {
        spaceId: internalDocument.attributes.spaceId,
        createdTime: internalDocument.attributes.createdTime,
        version: internalDocument.version,
        content: internalDocument.content,
        creatorId: internalDocument.attributes.creator.id,
    };
}

/**
 * Load the document's access policy for a bot scoped to the document. Used when
 * evaluating whether a bot has permissions to certain resources.
 */
export async function getDocumentAccessPolicyForBotScope(
    context: ServerMinimalBotActionContext,
    documentId: DocumentId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<EffectiveAccessPolicy> {
    const scope = context.actor.getScope();
    if (scope.type !== "Document" || scope.documentId !== documentId) {
        throw new PermissionDeniedError("Can only get access policy for the scoped document");
    }

    const item = await getDocumentItemForAuthorization(context, documentId, options);

    const [, accessPolicy] = await runAllPromises([
        authorizeSpaceAccess(context, item.spaceId),
        intoEffectiveAccessPolicy(context, item.accessPolicy),
    ]);

    return accessPolicy;
}

/**
 * Get a single document comment thread model object.
 */
export async function getDocumentCommentThread(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
    },
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<DocumentCommentThreadModel> {
    const [{spaceId}, commentThreadItem] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment", {consistency}),
        getDocumentCommentThreadItem(context, {documentId, commentThreadId, consistency}),
    ]);

    return await createDocumentCommentThreadModelFromItem(context, spaceId, commentThreadItem);
}

export async function getDocumentCommentThreadContent(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
    },
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
) {
    const [{spaceId}, commentThreadItem] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment", {consistency}),
        getDocumentCommentThreadItem(context, {documentId, commentThreadId, consistency}),
    ]);

    const firstCommentAuthorId = iterableFirst(
        commentThreadItem.commentsSummary.commentCountByAuthorId.keys(),
    );

    const fallbackContentSnippet = commentThreadItem.fallbackContentSnippet
        ? {
              version: commentThreadItem.fallbackContentSnippet.version,
              node: assertDocumentWithOptionalTitleContent(
                  stripDocumentContentCommentMarks(commentThreadItem.fallbackContentSnippet.node, {
                      exceptCommentThreadIds: new Set([commentThreadItem.commentThreadId]),
                  }),
              ),
          }
        : null;

    return {
        spaceId,
        id: commentThreadId,
        createdTime: commentThreadItem.createdTime,
        isResolved: commentThreadItem.resolutionState.type === "Resolved",
        commentCount: getDocumentCommentCount(commentThreadItem.commentsSummary),
        firstCommentAuthorId,
        fallbackContentSnippet,
    };
}

/**
 * Find all the `DocumentCommentThreadId`s currently referenced in the provided
 * `DocumentContent`.
 */
function getReferencedDocumentCommentThreadIds(content: Node): Set<DocumentCommentThreadId> {
    const commentThreadIds = new Set<DocumentCommentThreadId>();

    visitProsemirrorNode(content, {
        visitMark: mark => {
            if (mark.type.name === "comment") {
                commentThreadIds.add(assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId));
            }
        },
    });

    return commentThreadIds;
}

/**
 * `DocumentCommentThreadModel` is used to render a full comment thread. Including
 * a comment preview, its resolved state, and all the individual comments
 * underneath the thread.
 */
async function createDocumentCommentThreadModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    item: DocumentCommentThreadItem,
): Promise<DocumentCommentThreadModel> {
    const firstCommentAuthorId = iterableFirst(item.commentsSummary.commentCountByAuthorId.keys());

    const fallbackContentSnippetNode = item.fallbackContentSnippet
        ? assertDocumentWithOptionalTitleContent(
              stripDocumentContentCommentMarks(item.fallbackContentSnippet.node, {
                  exceptCommentThreadIds: new Set([item.commentThreadId]),
              }),
          )
        : null;

    const [firstCommentAuthor, fallbackContentSnippetReferences] = await runAllPromises([
        firstCommentAuthorId ? getAccount(context, spaceId, firstCommentAuthorId) : null,
        fallbackContentSnippetNode
            ? getContentReferencesForNode(
                  context,
                  spaceId,
                  FileDocumentAuthorizer.bind({type: "Document", documentId: item.documentId}),
                  fallbackContentSnippetNode,
              )
            : null,
    ]);

    return new DocumentCommentThreadModel({
        id: item.commentThreadId,
        documentId: item.documentId,
        createdTime: item.createdTime,
        version: item.updateLockVersion ?? 0,
        fallbackContentSnippet: fallbackContentSnippetNode
            ? {
                  doc: fallbackContentSnippetNode,
                  references: {
                      ...(fallbackContentSnippetReferences ?? emptyContentReferences),
                      // We strip all comment thread marks except for our own it's redundant to include a
                      // comment thread reference object for ourselves.
                      commentThreadById: new Map(),
                      // Fallback content snippets don't need sites - they're used for rendering comment
                      // thread previews where the full access policy isn't needed.
                      siteById: new Map(),
                  },
              }
            : null,
        isResolved: item.resolutionState.type === "Resolved",
        commentCount: getDocumentCommentCount(item.commentsSummary),
        firstCommentAuthor,
    });
}

/**
 * `DocumentCommentThreadReference` is used to render a comment thread in the
 * besides a document. It shows the number of comments and some comment authors.
 */
async function createDocumentCommentThreadReferenceFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    item: DocumentCommentThreadItem,
): Promise<DocumentCommentThreadReference> {
    const commentAuthors = await runAllPromises(
        mapIterable(item.commentsSummary.commentCountByAuthorId.keys(), accountId =>
            getAccount(context, spaceId, accountId),
        ),
    );

    return {
        commentCount: getDocumentCommentCount(item.commentsSummary),
        commentAuthors,
    };
}

/**
 * Get many comment threads in a document at once.
 *
 * This is not the most efficient of functions. We need to load each comment thread
 * separately instead of querying many comment threads at once. Use it when you
 * need to fetch a small subset of comment threads.
 *
 * Also returns a list of the resolved comment threads should the caller find that
 * useful. Remember the list of resolved comment threads is read with eventual
 * consistency.
 */
export async function batchGetDocumentCommentThreadReferencesIfExists(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds,
    }: {
        documentId: DocumentId;
        commentThreadIds: Iterable<DocumentCommentThreadId>;
    },
): Promise<{
    commentThreadById: Map<DocumentCommentThreadId, DocumentCommentThreadReference>;
    resolvedCommentThreadIds: Set<DocumentCommentThreadId>;
}> {
    const {spaceId} = await authorizeDocumentAccess(context, documentId, "Comment");

    const resolvedCommentThreadIds = new Set<DocumentCommentThreadId>();

    const commentThreadItems = await runAllPromises(
        mapIterable(commentThreadIds, async commentThreadId => {
            const commentThreadItem = await getDocumentCommentThreadItemIfExists(context, {
                documentId,
                commentThreadId,
            });
            if (!commentThreadItem) return null;

            if (commentThreadItem.resolutionState.type === "Resolved")
                resolvedCommentThreadIds.add(commentThreadItem.commentThreadId);

            return [
                commentThreadItem.commentThreadId,
                await createDocumentCommentThreadReferenceFromItem(
                    context,
                    spaceId,
                    commentThreadItem,
                ),
            ] as const;
        }),
    );

    return {
        commentThreadById: new Map(filterIterable(commentThreadItems, isNonNullable)),
        resolvedCommentThreadIds,
    };
}

export async function confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds,
    }: {
        documentId: DocumentId;
        commentThreadIds: Iterable<DocumentCommentThreadId>;
    },
): Promise<Array<DocumentCommentThreadId>> {
    await authorizeDocumentAccess(context, documentId, "Comment");

    const confirmedCommentThreadIds = await runAllPromises(
        mapIterable(commentThreadIds, async commentThreadId => {
            const commentThreadItem = await getDocumentCommentThreadItemIfExists(context, {
                documentId,
                commentThreadId,
                consistency: "Strong",
            });
            if (!commentThreadItem) return null;
            if (commentThreadItem.resolutionState.type !== "Resolved") return null;
            return commentThreadItem.commentThreadId;
        }),
    );

    return confirmedCommentThreadIds.filter(isNonNullable);
}

/**
 * How long before we removed document content from our cache. This is a debounce
 * timer. Whenever a user updates the document, we cancel any pending timer and
 * start a new one with this expiration time. So if the user is continuously
 * editing then we keep the content cached the entire time.
 */
export const documentContentCacheEvictionTimeoutMs = 1000 * 60 * 5;

/**
 * We have an in-memory cache for document content that we use ONLY when updating
 * document content.
 *
 * (We only use this cache for updates since it makes the cache easier to reason
 * about.)
 *
 * Document content updates happen many times per second so it's important that
 * document content updates are fast. This cache allows us to avoid reading
 * document content from the database when we update it. If the document content is
 * in-memory we can read it from this cache.
 *
 * When we read a document from the cache, we double check with the database to
 * make sure the cached content version is equal to the content version in the
 * database. If there is another process updating our document content then the
 * cache may not be up-to-date!
 */
export class DocumentContentCacheForUpdate {
    private readonly _entries = new DocumentContentCacheForUpdateEntries();

    public async getAndCacheDocument(
        context: ServerActionContext,
        id: DocumentId,
        {clientVersion}: {clientVersion: number},
    ): Promise<{
        readonly documentId: DocumentId;
        readonly createdTime: Date;
        readonly spaceId: SpaceId;
        readonly creator: {
            readonly id: AccountId | null;
            readonly from: DocumentCreatorFrom | null;
        };
        readonly lastIndexSearchEntityJob: DocumentIndexSearchEntityJob;
        readonly stepCountByAccountId: DocumentStepCountByAccountId;
        readonly hasAddedFeedCandidateEntry: boolean;
        readonly deleted: DocumentAttributesItemDeleted | null;
        readonly version: number;
        readonly content: DocumentContent;
        readonly accessPolicy: AccessPolicy;

        /**
         * Steps after the snapshot the content was loaded at.
         *
         * Some of these steps may be before the current document snapshot if the document
         * snapshot was updated after our cache loaded the document.
         */
        readonly stepsAfterInitialSnapshot: PushOnlyArraySlice<{
            readonly step: Step;
            readonly invertedStep: Step;
            readonly clientId: ContentEditorClientId;
        }>;

        /**
         * Update the cache with the provided content object and steps. We do not validate
         * that the new content or steps are correct and trust the caller to do that!
         */
        updateCache(options: {
            newContent: DocumentContent;
            newSteps: ReadonlyArray<Step>;
            newInvertedSteps: ReadonlyArray<Step>;
            newLastIndexSearchEntityJob: DocumentIndexSearchEntityJob;
            newStepCountByAccountId: DocumentStepCountByAccountId;
            newHasAddedFeedCandidateEntry: boolean;
            newDeleted: DocumentAttributesItemDeleted | null;
            clientId: ContentEditorClientId;
        }): Promise<void>;
    } | null> {
        return await context.tracer.withSpan("Get and cache document", async (context, span) => {
            let wasEntryCached = true;

            const nullableEntry = await this._entries.getOrSetEntry(id, async () => {
                wasEntryCached = false;

                const internalDocument = await getInternalDocumentIfExists(context, id);
                if (!internalDocument) return null;

                return {
                    createdTime: internalDocument.attributes.createdTime,
                    spaceId: internalDocument.attributes.spaceId,
                    creator: internalDocument.attributes.creator,
                    lastIndexSearchEntityJob: internalDocument.attributes.lastIndexSearchEntityJob,
                    stepCountByAccountId: internalDocument.attributes.stepCountByAccountId,
                    hasAddedFeedCandidateEntry:
                        internalDocument.attributes.hasAddedFeedCandidateEntry,
                    deleted: internalDocument.attributes.deleted,
                    version: internalDocument.version,
                    content: internalDocument.content,
                    accessPolicy: internalDocument.content.attrs.accessPolicy,
                    stepsAfterInitialSnapshot: new PushOnlyArray(
                        flatMapIterable(
                            internalDocument.stepTransactionsAfterSnapshot,
                            ({steps, invertedSteps, clientId}) => {
                                return mapIterable(steps, (step, i) => {
                                    const invertedStep = invertedSteps[i];
                                    if (!invertedStep)
                                        throw new DataLossError("Missing inverted document step");

                                    return {step, invertedStep, clientId};
                                });
                            },
                        ),
                    ),
                };
            });

            span.addData({common: {wasCached: wasEntryCached}});

            if (!nullableEntry) return null;
            let entry = nullableEntry;

            if (
                // If our content was already cached, then we want to verify that the cached
                // content version is the same as the content version in the database.
                //
                // Another process may have written to the database in which case the cache in this
                // process wouldn't know. If another process wrote to the database we can't use our
                // cached entry so should update our cache appropriately.
                wasEntryCached ||
                // If the client has a newer version of the document than us (and the entry was NOT
                // cached), that may mean our eventually consistent `getInternalDocumentIfExists()`
                // returned stale data. So re-read the document `Attributes` again to see if the
                // client is wrong or if we have stale data and need to load more steps.
                clientVersion > entry.version
            ) {
                let nullableAttributes = await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "Attributes",
                });

                if (
                    // If we read a past version of the document that might be because we're using
                    // DynamoDB eventual consistency and we can't yet read the latest write. So try to
                    // load the document one more time but with strong consistency instead.
                    !nullableAttributes ||
                    entry.version > nullableAttributes.version ||
                    // If the client has a newer version of the document than what we got from an
                    // eventually consistent read of `Attributes` then the item we read might be stale.
                    // So try reading again but with strong consistency.
                    clientVersion > nullableAttributes.version
                ) {
                    nullableAttributes = await DocumentsTable.getItem(
                        context,
                        {
                            partitionType: "Document",
                            documentId: id,
                            sortRangeType: "Attributes",
                        },
                        {consistency: "Strong"},
                    );

                    if (entry.version > nullableAttributes.version) {
                        throw new InternalError(
                            "We\u2019ve cached document content that has a version number ahead of what\u2019s in the database",
                        );
                    }

                    if (clientVersion > nullableAttributes.version) {
                        // If the client version is STILL higher than what we have in the database, now we
                        // know the client's version is incorrect. We don't throw an error here. An error
                        // will be thrown later by `getCollaborativelyUpdateContentResult()` (which will
                        // also include some useful span data for debugging).
                    }
                }

                // `const` reference so TypeScript doesn't think this is nullable.
                const attributes = nullableAttributes;

                // If the version in our cache is less than what's in the database, then let's load
                // the steps we are missing and apply them to our content.
                if (entry.version < attributes.version) {
                    const nullableEntry = await this._entries.updateEntry(id, async entry => {
                        if (!entry) return null;

                        // A concurrent updater may have moved our entry version all the way forward
                        // already.
                        if (entry.version >= attributes.version) return entry;

                        const steps = await getDocumentContentStepsBetweenValidatedVersionRange(
                            context,
                            {
                                id,
                                startVersion: entry.version,
                                endVersion: attributes.version,
                            },
                        );

                        let content = entry.content;

                        for (const step of steps) {
                            const stepResult = step.step.apply(content);
                            if (!stepResult.doc)
                                throw new DataLossError(
                                    `Step after document snapshot could not be applied: ${stepResult.failed!}`,
                                );

                            assert(isDocumentContent(stepResult.doc));
                            content = stepResult.doc;

                            entry.stepsAfterInitialSnapshot.push(step);
                        }

                        return {
                            createdTime: entry.createdTime,
                            spaceId: entry.spaceId,
                            creator: entry.creator,
                            lastIndexSearchEntityJob: attributes.lastIndexSearchEntityJob,
                            stepCountByAccountId: attributes.stepCountByAccountId,
                            hasAddedFeedCandidateEntry: attributes.hasAddedFeedCandidateEntry,
                            deleted: attributes.deleted,
                            version: attributes.version,
                            content,
                            stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot,
                        };
                    });

                    if (!nullableEntry) return null;
                    entry = nullableEntry;
                }
            }

            return {
                documentId: id,
                createdTime: entry.createdTime,
                spaceId: entry.spaceId,
                creator: entry.creator,
                lastIndexSearchEntityJob: entry.lastIndexSearchEntityJob,
                stepCountByAccountId: entry.stepCountByAccountId,
                hasAddedFeedCandidateEntry: entry.hasAddedFeedCandidateEntry,
                deleted: entry.deleted,
                version: entry.version,
                content: entry.content,
                accessPolicy: entry.content.attrs.accessPolicy,
                // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the array
                // from within this function, other code with a reference to the array won't see
                // the new values.
                stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),

                updateCache: async ({
                    newContent,
                    newSteps,
                    newInvertedSteps,
                    newLastIndexSearchEntityJob,
                    newStepCountByAccountId,
                    newHasAddedFeedCandidateEntry,
                    newDeleted,
                    clientId,
                }) => {
                    const updatedEntry = entry;

                    await this._entries.updateEntry(id, async entry => {
                        if (!entry) return null;

                        if (entry.version !== updatedEntry.version) return entry;

                        for (let i = 0; i < newSteps.length; i++) {
                            const step = newSteps[i]!;
                            const invertedStep = newInvertedSteps[i];
                            assert(invertedStep);
                            entry.stepsAfterInitialSnapshot.push({step, invertedStep, clientId});
                        }

                        return {
                            createdTime: entry.createdTime,
                            spaceId: entry.spaceId,
                            creator: entry.creator,
                            lastIndexSearchEntityJob: newLastIndexSearchEntityJob,
                            stepCountByAccountId: newStepCountByAccountId,
                            hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                            deleted: newDeleted,
                            version: entry.version + newSteps.length,
                            content: newContent,
                            stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot,
                        };
                    });
                },
            };
        });
    }

    public evictAllDocumentsForTest() {
        this._entries.evictAllEntriesForTest();
    }
}

type DocumentContentCacheForUpdateEntry = {
    readonly createdTime: Date;
    readonly spaceId: SpaceId;
    readonly creator: {
        readonly id: AccountId | null;
        readonly from: DocumentCreatorFrom | null;
    };
    readonly lastIndexSearchEntityJob: DocumentIndexSearchEntityJob;
    readonly stepCountByAccountId: DocumentStepCountByAccountId;
    readonly hasAddedFeedCandidateEntry: boolean;
    readonly deleted: DocumentAttributesItemDeleted | null;
    readonly version: number;
    readonly content: DocumentContent;

    /**
     * Steps after the snapshot the content was loaded at.
     *
     * Every new step applied to the document content will be pushed to this array.
     *
     * We never remove steps from this array which is why the name specifies "initial
     * snapshot". The snapshot may be different from when we loaded this content but we
     * won't evict steps from this list.
     *
     * By only pushing to this array it also means we can efficiently create immutable
     * slices in O(1) time instead of an O(n) time clone.
     */
    readonly stepsAfterInitialSnapshot: PushOnlyArray<{
        readonly step: Step;
        readonly invertedStep: Step;
        readonly clientId: ContentEditorClientId;
    }>;
};

type ReadonlyDocumentContentCacheForUpdateEntry = Replace<
    DocumentContentCacheForUpdateEntry,
    {
        readonly stepsAfterInitialSnapshot: PushOnlyArraySlice<{
            readonly step: Step;
            readonly invertedStep: Step;
            readonly clientId: ContentEditorClientId;
        }>;
    }
>;

/**
 * Small helper for managing `DocumentContentCacheForUpdate` that handles cache
 * eviction.
 *
 * You shouldn't have to worry about cache eviction outside of this class.
 */
class DocumentContentCacheForUpdateEntries {
    private readonly _entryByDocumentId = new Map<
        DocumentId,
        {
            evictionTimeout: Timeout;
            evict: () => void;
            promise: Promise<DocumentContentCacheForUpdateEntry | null>;
        }
    >();

    constructor() {
        // In our test environment, add a hook to evict all cached content at the end of
        // every test. That way we don't have timeouts sitting around and firing randomly.
        if (typeof afterEach !== "undefined") {
            assert(import.meta.jest);

            afterEach(() => {
                this.evictAllEntriesForTest();
            });
        }
    }

    public evictAllEntriesForTest() {
        assert(import.meta.jest);

        for (const entry of this._entryByDocumentId.values()) {
            entry.evict();
        }
    }

    /**
     * Either get an existing entry for the provided document id or set an entry using
     * the provided function.
     */
    public getOrSetEntry(
        id: DocumentId,
        getData: () => Promise<DocumentContentCacheForUpdateEntry | null>,
    ): Promise<ReadonlyDocumentContentCacheForUpdateEntry | null> {
        const entry = this._entryByDocumentId.get(id);
        if (!entry) return this.updateEntry(id, getData);

        return entry.promise.then(entry => {
            if (!entry) return null;
            return {
                ...entry,
                // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the array
                // from within this function, other code with a reference to the array won't see
                // the new values.
                //
                // You can only push new values in the update callback.
                stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),
            };
        });
    }

    /**
     * Set the entry in our map for the provided id. If there is already an entry for
     * the provided id then we will evict that entry. Calling this method will start an
     * eviction timer at which point the entry you added will be evicted from the
     * cache.
     *
     * The update callback is queued behind previous concurrent updates.
     */
    public updateEntry(
        id: DocumentId,
        update: (
            entry: DocumentContentCacheForUpdateEntry | null,
        ) => Promise<DocumentContentCacheForUpdateEntry | null>,
    ): Promise<ReadonlyDocumentContentCacheForUpdateEntry | null> {
        // Evict the last entry before setting the new entry.
        const lastEntry = this._entryByDocumentId.get(id);
        lastEntry?.evict();

        const evict = () => {
            // If our entry was already evicted then don't evict it again.
            if (this._entryByDocumentId.get(id) !== nextEntry) return;

            nextEntry.evictionTimeout.clear();
            this._entryByDocumentId.delete(id);
        };

        const evictionTimeout = createTimeout(() => {
            evict();
        }, documentContentCacheEvictionTimeoutMs);

        const nextEntry = {
            evictionTimeout,
            evict,
            promise: (lastEntry?.promise ?? Promise.resolve(null)).then(update).then(
                data => {
                    // Immediately evict if the document doesn't exist.
                    if (data === null) evict();
                    return data;
                },
                error => {
                    // Immediately evict if we failed to get the data.
                    evict();
                    throw error;
                },
            ),
        };
        this._entryByDocumentId.set(id, nextEntry);

        return nextEntry.promise.then(entry => {
            if (!entry) return null;
            return {
                ...entry,
                // Create a slice of `stepsAfterInitialSnapshot` so that when we mutate the array
                // from within this function, other code with a reference to the array won't see
                // the new values.
                //
                // You can only push new values in the update callback.
                stepsAfterInitialSnapshot: entry.stepsAfterInitialSnapshot.slice(),
            };
        });
    }
}

/**
 * Small helper which allows us to create a slice of an append-only array without
 * cloning the array. A naive implementation of the native `Array.slice()` method
 * will clone the entire array.
 */
class PushOnlyArray<Item> implements Iterable<Item> {
    private readonly _array: Array<Item>;

    constructor(iterable: Iterable<Item>) {
        // Create a new array so we can make sure nothing else can mutate the array.
        this._array = Array.from(iterable);
    }

    public get length(): number {
        return this._array.length;
    }

    public get(index: number): Item | undefined {
        return this._array[index];
    }

    public push(item: Item): void {
        this._array.push(item);
    }

    public slice(start: number = 0, end: number = this.length): PushOnlyArraySlice<Item> {
        return new PushOnlyArraySlice(this, start, end);
    }

    public *[Symbol.iterator](): Iterator<Item> {
        // Cache length so if an item is appended it won't appear in this iterator.
        const length = this._array.length;
        for (let i = 0; i < length; i++) yield this._array[i]!;
    }
}

class PushOnlyArraySlice<Item> implements Iterable<Item> {
    private readonly _array: PushOnlyArray<Item>;
    private readonly _start: number;
    private readonly _end: number;

    constructor(array: PushOnlyArray<Item>, start: number, end: number) {
        this._array = array;
        this._start = clamp(0, Math.floor(start), array.length);
        this._end = clamp(this._start, Math.floor(end), array.length);
    }

    public get length() {
        return this._end - this._start;
    }

    public slice(start: number = 0, end: number = this.length): PushOnlyArraySlice<Item> {
        return new PushOnlyArraySlice(
            this._array,
            this._start + clamp(0, start, this.length),
            this._start + clamp(0, end, this.length),
        );
    }

    public *[Symbol.iterator](): Iterator<Item> {
        for (let i = this._start; i < this._end; i++) yield this._array.get(i)!;
    }
}

const globalDocumentContentCacheForUpdate = new DocumentContentCacheForUpdate();

export function getGlobalDocumentContentCacheForUpdateForTest() {
    assert(import.meta.jest);
    return globalDocumentContentCacheForUpdate;
}

export const updateDocumentContentBeforeExecuteTransactionTestCheckpoint = new TestCheckpoint<{
    id: DocumentId;
    clientId: ContentEditorClientId;
}>();

/**
 * Updates our document by applying some steps.
 *
 * The version number must be less than or equal to the current document version.
 * If the version is less than we will rebase the steps you provided against the
 * new document steps.
 *
 * ### Comments
 *
 * You may use this method to atomically create a comment thread along with
 * updating the document's content. You will do this by adding a `comment` mark to
 * some text and creating a comment thread with the same `DocumentCommentThreadId`
 * as what is in your mark.
 *
 * You MAY NOT create a comment thread (with the `createCommentThread` option) if
 * the comment thread is not somehow represented in the update steps.
 *
 * You MAY use the `comment` mark in steps with a comment thread that was
 * previously created (maybe you are copy/pasting or undoing a change).
 *
 * We do not validate that `comment` marks you use correspond to a comment thread
 * in the database. To do this we'd have to fetch all referenced comment threads in
 * your steps which could get expensive if you were pasting a large amount of
 * content.
 *
 * ### Performance
 *
 * This function will be called a lot while a user is updating a document. So we've
 * tried to carefully optimize this function to have O(steps) performance and not
 * O(contentSize) performance.
 *
 * We do this by:
 *
 * - Caching the current content in memory so we don't need to load it from the
 *   database on every update.
 * - Only saving the full content back to the database every 20-100 steps. For the
 *   majority of updates we only save the steps.
 */
export async function updateDocumentContent(
    context: ServerAccountActionContext,
    {
        id: documentId,
        version: clientVersion,
        steps: clientSteps,
        clientId,
        clientRequestToken,
        intentionallyUpdateAccessPolicy,
        intentionallyUpdateDeletedTime,
        createCommentThreads = [],
        resolveCommentThreadIds = [],
        unresolveCommentThreadIds = [],
        cacheOverrideForTest,
    }: {
        id: DocumentId;
        version: number;
        steps: ReadonlyArray<Step>;
        clientId: ContentEditorClientId;
        clientRequestToken?: Id;
        intentionallyUpdateAccessPolicy?: {
            accessPolicy: CreateOrUpdateAccessPolicy;
            notification: ShareNotification | null;
        };
        intentionallyUpdateDeletedTime?: {
            deletedTime: Date;
        };
        createCommentThreads?: ReadonlyArray<{
            commentThreadId: DocumentCommentThreadId;
            initialCommentContent: MessageContent;
            initialCommentFileIds: ReadonlyArray<FileId | FileEntityId>;
            createdTimeZone: TimeZone;
            attachInitialCommentFilesAsBot?: boolean;

            /**
             * Optionally allow the caller to specify the time at which we report the thread
             * was created. Used by our document collaboration service to use the optimistic
             * creation time of the comment thread.
             */
            createdTime?: Date;
            overrideCreatedTimeForTest?: Date;
        }>;
        resolveCommentThreadIds?: ReadonlyArray<DocumentCommentThreadId>;
        unresolveCommentThreadIds?: ReadonlyArray<DocumentCommentThreadId>;
        cacheOverrideForTest?: DocumentContentCacheForUpdate;
    },
): Promise<{
    /**
     * The new version of the document after applying our update.
     *
     * If there are no `conflictingSteps` then this should be `version + steps.length`.
     */
    newVersion: number;

    /**
     * The document content after the update.
     */
    newContent: DocumentContent;

    /**
     * The `steps` array we passed in but transformed with a rebase against
     * `conflictingSteps`.
     *
     * These steps were applied after `conflictingSteps`.
     */
    newSteps: ReadonlyArray<Step>;

    /**
     * The inverted steps of the returned `newSteps`.
     */
    newInvertedSteps: ReadonlyArray<Step>;

    /**
     * If the client passed in a `version` that was not equal to the actual version of
     * the document, then this function will have loaded steps between the client
     * provided `version` and the actual document version and used those steps to
     * rebase the client provided `steps`. The steps between the client `version` and
     * actual version are the conflicting steps and are returned here.
     *
     * Since these steps come from other clients making collaborative edits `clientId`
     * is included.
     */
    conflictingSteps: ReadonlyArray<{step: Step; clientId: ContentEditorClientId}>;

    /**
     * Comment thread model objects for threads that were updated during this content
     * update. So comments updated with `resolveCommentThreadIds` or
     * `unresolveCommentThreadIds`.
     *
     * Doesn't include comments created with `createCommentThreads` since those
     * comments were created not updated.
     */
    updatedCommentThreads: ReadonlyArray<DocumentCommentThreadModel>;

    /**
     * Realtime events for any site item / site preview writes that happened in the
     * same dynamo transaction as the document update (i.e. when the new access policy
     * switched the document into or out of a site). Document content events flow
     * through the document collaboration WebSocket protocol, so only site events are
     * surfaced here.
     */
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    const result = await context.dynamo.retryTransaction(async context => {
        if (!Number.isSafeInteger(clientVersion) || clientVersion < 0)
            throw new InvalidArgumentError("Expected a positive integer version number");

        // NOTE(calebmer, 2023-09-19): Do we really need the cache anymore now that we're
        // using Durable Objects for updating documents? For now, probably yes? The Durable
        // Object sends updates to `AppService` so in theory the cache helps persist
        // updates faster. The problem is `AppService` is behind a load balancer so Durable
        // Objects would need [sticky sessions][1] to make sure it goes to the same
        // `AppService` with the right cache. Though who knows, maybe the cache only helps
        // a marginal amount even when configured properly.
        //
        // NOTE(calebmer, 2024-09-19): Added the span "Get and cache document" to help make
        // this decision. Check how many cache hits we have and what performance difference
        // it makes. To determine if the cache is a good idea I want to know the
        // performance difference between cache hits and misses. Then if there's a low
        // cache hit rate I suspect that's because of a sticky session bug where AWS ALB
        // routes sticky sessions to the same `AppService` but within the Node.js server we
        // don't route sticky sessions to the same Node.js process. Also, ideally I'd like
        // members of the same space to route to the same Node.js process in AWS.
        //
        // [1]:
        //     https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html
        const cache = cacheOverrideForTest ?? globalDocumentContentCacheForUpdate;
        assert(
            cache === globalDocumentContentCacheForUpdate || import.meta.jest,
            "Can only override the cache in Jest tests",
        );

        const currentTime = new Date();

        if (createCommentThreads.length > 0) {
            const stepCommentThreadIds = new Set<DocumentCommentThreadId>();

            for (const step of clientSteps) {
                visitProsemirrorStep(step, {
                    visitMark: mark => {
                        if (mark.type.name === "comment") {
                            stepCommentThreadIds.add(assertId(mark.attrs.commentThreadId));
                        }
                    },
                });
            }

            for (const createCommentThread of createCommentThreads) {
                if (!stepCommentThreadIds.has(createCommentThread.commentThreadId)) {
                    throw new InvalidArgumentError(
                        "When creating a comment thread the `commentThreadId` must be referenced in document update steps",
                    );
                }

                // `createdTime` shouldn't be wholly inaccurate but allow for some clock drift. In
                // some cases `createdTime` may be set a couple minutes before when optimistically
                // creating comment threads.
                if (
                    createCommentThread.createdTime &&
                    Math.abs(differenceInMinutes(currentTime, createCommentThread.createdTime)) > 20
                ) {
                    throw new InvalidArgumentError(
                        "When creating a comment thread `createdTime` should be within 20 minutes of the current time",
                    );
                }
            }
        }

        // We don't require an `AddMarksAfterRemoveAllStep` for `unresolveCommentThreadIds`
        // because when rebasing `AddMarksAfterRemoveAllStep` ranges with old steps, we may
        // end up with no ranges and remove the `AddMarksAfterRemoveAllStep`.
        for (const commentThreadId of resolveCommentThreadIds) {
            const removeAllMarksStep = clientSteps.find(
                step =>
                    step instanceof RemoveAllMarksStep &&
                    step.mark.type.name === "comment" &&
                    step.mark.attrs.commentThreadId === commentThreadId,
            );

            if (!removeAllMarksStep) {
                throw new InvalidArgumentError(
                    "When resolving a comment thread there must be a `removeAllMarks` step for the comment thread",
                );
            }

            // Important: We depend on positions being the same at the start and end of this
            // update when resolving comment threads. So we can only allow steps that don't
            // move positions. e.g. `RemoveAllMarksStep` or `AddMarkStep`.
            if (!clientSteps.every(step => step instanceof RemoveAllMarksStep)) {
                throw new InvalidArgumentError(
                    "When resolving a comment thread only `removeAllMarks` steps can be used",
                );
            }
        }

        const internalDocument = await cache.getAndCacheDocument(context, documentId, {
            clientVersion,
        });
        if (!internalDocument)
            throw new NotFoundError("Can not update document that doesn\u2019t exist");

        const expectedAccessLevel =
            getExpectedAccessLevelForUpdateDocumentContentSteps(clientSteps);

        // Make sure we have edit access to the document before continuing. Another user
        // with access may have cached the document so it's important we check permissions
        // here.
        await authorizeDocumentItemAccess(context, internalDocument, expectedAccessLevel);

        const initialCommentFileIdsToAttachAsBot = new Set<FileId>();
        const existingInitialCommentFileValidationPromises: Array<Promise<unknown>> = [];

        for (const createCommentThread of createCommentThreads) {
            for (const fileId of createCommentThread.initialCommentFileIds) {
                if (!isId<FileId>(fileId)) continue;

                if (createCommentThread.attachInitialCommentFilesAsBot) {
                    initialCommentFileIdsToAttachAsBot.add(fileId);
                } else {
                    existingInitialCommentFileValidationPromises.push(
                        getFileFromAttachment(
                            context,
                            fileId,
                            FileDocumentAuthorizer.bind({
                                type: "DocumentComments",
                                documentId,
                            }),
                        ),
                    );
                }
            }
        }

        const [
            {newContent, steps, invertedSteps, conflictingSteps},
            ,
            initialCommentFileAttachmentTransactionEntries,
        ] = await runAllPromises([
            getCollaborativelyUpdateContentResult(context, {
                currentVersion: internalDocument.version,
                currentContent: internalDocument.content,
                clientVersion,
                clientSteps,
                getSteps: async (startVersion, endVersion) => {
                    // As an optimization, we assume implementation details about which range of steps
                    // this function is requesting and use our internal data structures to attempt at
                    // efficiently returning a value for this function.
                    assert(startVersion === clientVersion);
                    assert(endVersion === internalDocument.version);

                    // Get the steps that were applied to bring our document from the provided version
                    // to the document's current version.
                    //
                    // If we're lucky then the version we're trying to update is after our snapshot so
                    // we've already loaded all the steps after the snapshot. Otherwise we need to read
                    // new steps.
                    if (
                        clientVersion >=
                        internalDocument.version - internalDocument.stepsAfterInitialSnapshot.length
                    ) {
                        const stepCount = internalDocument.version - clientVersion;

                        return Array.from(
                            internalDocument.stepsAfterInitialSnapshot.slice(
                                internalDocument.stepsAfterInitialSnapshot.length - stepCount,
                            ),
                        );
                    } else {
                        const otherSteps =
                            await getDocumentContentStepsBetweenValidatedVersionRange(context, {
                                id: documentId,
                                startVersion: clientVersion,
                                endVersion:
                                    internalDocument.version -
                                    internalDocument.stepsAfterInitialSnapshot.length,
                            });

                        return [...otherSteps, ...internalDocument.stepsAfterInitialSnapshot];
                    }
                },
            }),
            runAllPromises(existingInitialCommentFileValidationPromises),
            runAllPromises(
                Array.from(initialCommentFileIdsToAttachAsBot, fileId =>
                    dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
                        context,
                        fileId,
                        FileDocumentAuthorizer.bind({
                            type: "DocumentComments",
                            documentId,
                        }),
                    ),
                ),
            ),
        ]);

        assert(isDocumentContent(newContent));

        const oldAccessPolicy: AccessPolicy = internalDocument.content.attrs.accessPolicy;
        const newAccessPolicy: AccessPolicy = newContent.attrs.accessPolicy;

        const hasAccessPolicyChanged = !isDeepEqual(oldAccessPolicy, newAccessPolicy);

        const oldDeletedTime: Date | null = internalDocument.content.attrs.deletedTime;
        const newDeletedTime: Date | null = newContent.attrs.deletedTime;
        const hasDeletedTimeChanged = oldDeletedTime?.getTime() !== newDeletedTime?.getTime();

        // We don't allow the deleted time to be updated unless
        // `intentionallyUpdateDeletedTime` is defined. This is a protection which prevents
        // the deleted time from being updated accidentally by ProseMirror.
        if (!intentionallyUpdateDeletedTime && hasDeletedTimeChanged) {
            throw new PermissionDeniedError(
                "Can\u2019t update the document\u2019s deleted time unless `intentionallyUpdateDeletedTime` is provided",
            );
        }

        if (
            intentionallyUpdateDeletedTime &&
            intentionallyUpdateDeletedTime.deletedTime.getTime() !== newDeletedTime?.getTime()
        ) {
            throw new PermissionDeniedError(
                "The document\u2019s new deleted time doesn\u2019t match `intentionallyUpdateDeletedTime`",
            );
        }

        // We don't allow the access policy to be updated unless
        // `intentionallyUpdateAccessPolicy` is defined. This is a protection which
        // prevents the access policy from being updated accidentally by ProseMirror. It
        // would be absolutely horrible if while editing a document ProseMirror
        // accidentally clears the `accessPolicy` attr causing it to reset to the default
        // which is public to everyone in the space.
        //
        // By forcing developers to set `intentionallyUpdateAccessPolicy` we know this
        // update intended to update the access policy.
        if (!intentionallyUpdateAccessPolicy && hasAccessPolicyChanged) {
            throw new PermissionDeniedError(
                "Can\u2019t update the document\u2019s access policy unless `intentionallyUpdateAccessPolicy` is provided",
            );
        }

        const inentionallyUpdatedAccessPolicyWithoutSitePosition =
            intentionallyUpdateAccessPolicy?.accessPolicy?.type === "Site"
                ? omitObject(intentionallyUpdateAccessPolicy.accessPolicy, ["position"])
                : intentionallyUpdateAccessPolicy?.accessPolicy;
        // `intentionallyUpdateAccessPolicy` must exactly match the access policy we update
        // the document to. This is a protection to prevent ProseMirror from accidentally
        // updating the access policy in a way the developer didn't intend.
        if (
            intentionallyUpdateAccessPolicy &&
            !isDeepEqual(inentionallyUpdatedAccessPolicyWithoutSitePosition, newAccessPolicy)
        ) {
            throw new PermissionDeniedError(
                "The document\u2019s new access policy doesn\u2019t match `intentionallyUpdateAccessPolicy`",
            );
        }

        // Must have the `Manage` permission level to update the access policy or delete a
        // document.
        if (
            hasAccessPolicyChanged ||
            intentionallyUpdateAccessPolicy ||
            hasDeletedTimeChanged ||
            intentionallyUpdateDeletedTime
        ) {
            await authorizeDocumentItemAccess(context, internalDocument, "Manage");
        }

        let newEffectiveAccessPolicy: EffectiveAccessPolicy | null = null;
        const intentionallyUpdatedAccessPolicyTransactionEntries: Array<{
            transactionEntry: RynamoTransactionEntry;
            getEvent: (
                context: ServerActionContext,
            ) => Promise<RynamoEvent<SitePreviewModel | SiteEntryModel>>;
        }> = [];
        // Make sure the access policy update is valid and the actor isn't removing access
        // from accounts with a lower manage generation.
        if (hasAccessPolicyChanged) {
            const intentionalAccessPolicy = assertExists(
                intentionallyUpdateAccessPolicy?.accessPolicy,
            );

            const {resolvedAccessPolicy, transactionEntries} =
                await validateAccessPolicyUpdateForServer(
                    context,
                    internalDocument.spaceId,
                    `Document:${documentId}`,
                    oldAccessPolicy,
                    intentionalAccessPolicy,
                );
            newEffectiveAccessPolicy = resolvedAccessPolicy;

            // Each entry in `add` / `remove` is `{transactionEntry, getEvent}`. The entries
            // are `RynamoTransactionEntry` instances; we cast via `unknown` to
            // `DynamoTransactionEntry` so we can push them onto the shared transaction array.
            // The commit below switches to `RynamoTableSchema.executeTransaction` when any
            // site entries are present — that variant accepts both entry types and broadcasts
            // realtime events for the site entries.
            for (const entry of transactionEntries) {
                intentionallyUpdatedAccessPolicyTransactionEntries.push(entry);
            }
        }
        newEffectiveAccessPolicy ??= await intoEffectiveAccessPolicy(context, newAccessPolicy);

        // Add a feed candidate entry when the document is given a default grant for the
        // first time.
        const oldHasAddedFeedCandidateEntry = internalDocument.hasAddedFeedCandidateEntry;
        const newHasAddedFeedCandidateEntry =
            oldHasAddedFeedCandidateEntry || !!newEffectiveAccessPolicy.defaultGrant;

        const newDeleted: DocumentAttributesItemDeleted | null = hasDeletedTimeChanged
            ? newDeletedTime
                ? {
                      time: newDeletedTime,
                      deletor: {
                          id: context.actor.getPossiblyBotAccountId(),
                          from:
                              context.actor.type === "Bot"
                                  ? {type: "Bot", accountId: context.actor.getBotAccountId()}
                                  : null,
                      },
                  }
                : null
            : internalDocument.deleted;

        const commentThreadItemPromiseById = new Map<
            DocumentCommentThreadId,
            Promise<DocumentCommentThreadItem | null>
        >();

        // When a comment mark is being removed from a document, if that's the last
        // instance of the comment mark then we want to save a snippet of content around
        // that mark at the time it was removed that we can render alongside the comment
        // thread in a preview so the user doesn't lose context about what the comment
        // thread was about.
        //
        // Cases when a comment thread could be completely removed from a document:
        //
        // - The user is resolving a comment thread and so updating the document with a
        //   `removeAllMarks` step.
        //
        // - The user deleted content including the only reference to a comment.
        //
        // We do all of this before actually updating the document in the database. This
        // means we may save content snippets for referenced comment threads. We don't
        // include these updates in our document update transaction since many comment
        // threads can be deleted from the document at once.
        {
            const removedCommentThreadIds = new Set<DocumentCommentThreadId>();

            // 1. Find all comment marks removed from the document this update by checking if
            //    an inverted step would add the mark back.
            for (const invertedStep of invertedSteps) {
                visitProsemirrorStep(invertedStep, {
                    visitMark: mark => {
                        if (mark.type.name === "comment") {
                            removedCommentThreadIds.add(mark.attrs.commentThreadId);
                        }
                    },
                });
            }

            // 2. Check if any removed comment marks appear somewhere else in the document. If
            //    the mark doesn't appear elsewhere then we consider the comment thread to be
            //    totally removed.
            if (removedCommentThreadIds.size > 0) {
                visitProsemirrorNode(newContent, {
                    visitMark: mark => {
                        if (mark.type.name === "comment") {
                            removedCommentThreadIds.delete(mark.attrs.commentThreadId);
                        }
                    },
                });
            }

            // 3. For any totally removed comments, save a content snippet from our old
            //    document content with the comment thread.
            if (removedCommentThreadIds.size > 0) {
                // Get content snippets for our removed comment threads from the old document
                // content. Snippets won't exist in the new document content.
                const contentSnippetByCommentThreadId = createDocumentCommentThreadSnippetCollector(
                    removedCommentThreadIds,
                )(internalDocument.content);

                await runAllPromises(
                    Array.from(removedCommentThreadIds, async commentThreadId => {
                        const contentSnippet = contentSnippetByCommentThreadId.get(commentThreadId);
                        if (!contentSnippet) return;

                        const commentThreadItem = await getOrSetDefaultMapValue(
                            commentThreadItemPromiseById,
                            commentThreadId,
                            () =>
                                getDocumentCommentThreadItemIfExists(context, {
                                    documentId: documentId,
                                    commentThreadId,
                                    // Unresolved comments are likely to be referenced.
                                    shouldTryArchiveFirst: false,
                                }),
                        );

                        // Comment may have been copied from a different document.
                        if (!commentThreadItem) return;

                        // If the comment thread already has a content snippet then only update if our
                        // snippet is from a newer version.
                        if (
                            !commentThreadItem.fallbackContentSnippet ||
                            commentThreadItem.fallbackContentSnippet.version <
                                internalDocument.version
                        ) {
                            const newCommentThreadItem: DocumentCommentThreadItem = {
                                ...commentThreadItem,
                                fallbackContentSnippet: {
                                    version: internalDocument.version,
                                    // Convert from `DocumentContent` to `DocumentWithOptionalTitleContent`. This
                                    // should also drop the `accessPolicy` attr on `doc`.
                                    node: assertDocumentWithOptionalTitleContent(
                                        DocumentWithOptionalTitleContentProsemirrorSchema.nodeFromJSON(
                                            contentSnippet.node.toJSON(),
                                        ),
                                    ),
                                },
                            };

                            // If we are going to resolve or unresolve this comment thread in this update,
                            // let's save some capacity units and not make a second write here.
                            //
                            // We need to update `commentThreadItemPromiseById` so that later if we need to
                            // read the comment thread again the updated item is what's in the cache.
                            if (
                                !resolveCommentThreadIds.includes(
                                    commentThreadItem.commentThreadId,
                                ) &&
                                !unresolveCommentThreadIds.includes(
                                    commentThreadItem.commentThreadId,
                                )
                            ) {
                                await DocumentsTable.directlyUpdateItem(
                                    context,
                                    newCommentThreadItem,
                                );

                                commentThreadItemPromiseById.set(
                                    commentThreadId,
                                    Promise.resolve({
                                        ...newCommentThreadItem,
                                        updateLockVersion:
                                            (newCommentThreadItem.updateLockVersion ?? 0) + 1,
                                    }),
                                );
                            } else {
                                commentThreadItemPromiseById.set(
                                    commentThreadId,
                                    Promise.resolve(newCommentThreadItem),
                                );
                            }
                        }
                    }),
                );
            }
        }

        // This checkpoint allows us to write a test against our transaction's condition.
        await updateDocumentContentBeforeExecuteTransactionTestCheckpoint.waitForTest({
            id: documentId,
            clientId,
        });

        const transaction: Array<DynamoTransactionEntry | RynamoTransactionEntry> = [];
        transaction.push(...initialCommentFileAttachmentTransactionEntries);

        let newLastIndexSearchEntityJob = internalDocument.lastIndexSearchEntityJob;
        let newStepCountByAccountId = internalDocument.stepCountByAccountId;

        if (steps.length > 0) {
            const newTitleWithoutFallback = getDocumentContentTitleWithoutFallback(newContent);

            const updatedTraits: Array<"Title" | "Authorization"> = [];

            if (
                getDocumentContentTitleWithoutFallback(internalDocument.content) !==
                    newTitleWithoutFallback ||
                // If the access policy updates then the title also implicitly updates since access
                // to the title depends on the access policy.
                oldAccessPolicy !== newAccessPolicy
            ) {
                updatedTraits.push("Title");
            }

            // Deletion is an authorization change — the document becomes inaccessible.
            if (oldAccessPolicy !== newAccessPolicy || hasDeletedTimeChanged) {
                updatedTraits.push("Authorization");
            }

            const areUpdatedTraitsInLastIndexSearchEntityJob =
                internalDocument.lastIndexSearchEntityJob.updatedTraits.type === "Any" ||
                (internalDocument.lastIndexSearchEntityJob.updatedTraits.type === "Some" &&
                    updatedTraits.every(
                        trait =>
                            internalDocument.lastIndexSearchEntityJob.updatedTraits.type ===
                                "Some" &&
                            internalDocument.lastIndexSearchEntityJob.updatedTraits.traits.includes(
                                trait,
                            ),
                    ));

            let shouldSendIndexSearchEntityJob = false;

            // Don't add another document index job until after the first one's delay has
            // finished. When the delayed indexing job runs it will pick up this update.
            //
            // Or add another document index job if a trait changed which isn't covered by the
            // last index job.
            if (
                !areUpdatedTraitsInLastIndexSearchEntityJob ||
                isDatePossiblyLessThanWithUncertaintyWindow(
                    internalDocument.lastIndexSearchEntityJob.sendTime.getTime() +
                        internalDocument.lastIndexSearchEntityJob.delaySeconds * 1000,
                    currentTime,
                )
            ) {
                shouldSendIndexSearchEntityJob = true;
                newLastIndexSearchEntityJob = {
                    sendTime: currentTime,
                    generation: internalDocument.lastIndexSearchEntityJob.generation + 1,
                    delaySeconds: getDocumentIndexSearchEntityJobDelaySeconds(
                        internalDocument.lastIndexSearchEntityJob.generation + 1,
                    ),
                    updatedTraits: {type: "Some", traits: updatedTraits},
                };
            }

            // Keep track of how much each account contributed to the document.
            if (context.actor.getPossiblyBotAccountId() !== internalDocument.creator.id) {
                const actualNewStepCountByAccountId = new Map(newStepCountByAccountId.get());

                const stepCount =
                    actualNewStepCountByAccountId.get(context.actor.getPossiblyBotAccountId()) ?? 0;

                actualNewStepCountByAccountId.set(
                    context.actor.getPossiblyBotAccountId(),
                    stepCount + steps.length,
                );

                newStepCountByAccountId = new DocumentStepCountByAccountId(
                    actualNewStepCountByAccountId,
                );
            }

            transaction.push(
                DocumentsTable.transactionReplaceItem(
                    {
                        partitionType: "Document",
                        sortRangeType: "Attributes",
                        documentId: documentId,
                        createdTime: internalDocument.createdTime,
                        spaceId: internalDocument.spaceId,
                        creator: internalDocument.creator,
                        version: internalDocument.version + steps.length,
                        titleWithoutFallback: newTitleWithoutFallback,
                        accessPolicy: newContent.attrs.accessPolicy,
                        lastIndexSearchEntityJob: newLastIndexSearchEntityJob,
                        stepCountByAccountId: newStepCountByAccountId,
                        hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                        deleted: newDeleted,
                    },
                    {
                        condition: {
                            // Make sure a concurrent writer hasn't updated the document version before us.
                            version: internalDocument.version,
                        },
                        onAfterTransactionExecutedSuccessfully: () => {
                            // NOTE(calebmer): We don't currently:
                            //
                            // 1. Send a notification if an account is mentioned in a document
                            // 2. Increase affinity scores when mentioning an account in a document
                            //
                            // Same with task notes.
                            //
                            // This feels correct since writing in a document is a continuous flow. A user may
                            // have accidentally typed in an account or mentioned in account then decided to
                            // delete it. Sending notifications while a user is still typing doesn't make sense
                            // either since the receiver sees a document in a partially finished state.
                            //
                            // So we treat notifications in document content or task notes content basically as
                            // styling options with no other effect. Hence no notification or affinity boost.
                            if (shouldSendIndexSearchEntityJob) {
                                context.jobs.send(
                                    {
                                        type: "IndexSearchEntity",
                                        spaceId: internalDocument.spaceId,
                                        update: {
                                            type: "Document",
                                            documentId: documentId,
                                            updatedTraits: {type: "Some", traits: updatedTraits},
                                        },
                                    },
                                    {delaySeconds: newLastIndexSearchEntityJob.delaySeconds},
                                );
                            }

                            // Send a notification, via chat, on behalf of the actor saying "so and so has
                            // shared this entity with you". We put this on the job queue since we don't need
                            // to execute this job immediately.
                            if (intentionallyUpdateAccessPolicy?.notification) {
                                context.jobs.send({
                                    type: "SendShareNotification",
                                    jobId: clientRequestToken ?? generateId(),
                                    spaceId: internalDocument.spaceId,
                                    actorAccountId: context.actor.getPossiblyBotAccountId(),
                                    entityId: `Document:${documentId}`,
                                    notification: intentionallyUpdateAccessPolicy.notification,
                                });
                            }

                            // If we just updated `hasAddedFeedCandidateEntry` to true this update then make
                            // sure to actually add the feed candidate entry. We add the feed candidate entry
                            // 5min after the document is shared (if the document doesn't have much content).
                            // In case the user shared the document before writing the document's title or any
                            // text. 5min gives the user time to write the document's introduction.
                            //
                            // ### Deciding when to immediately add the feed candidate
                            //
                            // We decide whether the document has "enough content" by looking at
                            // `lastIndexSearchEntityJob.generation` or `newContent.nodeSize`.
                            //
                            // `lastIndexSearchEntityJob.generation` can give us a very rough approximation of
                            // how much _time_ has been spent editing the document.
                            // `lastIndexSearchEntityJob.generation` is incremented at least once every 10
                            // seconds (`documentIndexSearchEntityJobFastDelaySeconds`) of editing. So if we
                            // wait for the generation to be 14 then we know there have been 14 10 second time
                            // periods where the user has made at least one edit (~2 minutes total).
                            //
                            // `content.nodeSize` detects if the user pasted in a bunch of content (or had a
                            // bot like ChatGPT write the content) and then shared the document without making
                            // many more updates.
                            if (newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry) {
                                const entry: FeedEntry = {
                                    type: "Document",
                                    documentId,
                                    sharedTime: currentTime,
                                    sharerId: context.actor.getPossiblyBotAccountId(),
                                    creator: internalDocument.creator,
                                    event: "SharedWithAccessPolicyDefaultGrant",
                                };

                                if (
                                    newLastIndexSearchEntityJob.generation >=
                                        documentIndexSearchEntityJobImmediatelyAddFeedCandidateEntryAfterGeneration ||
                                    // We want enough text that we can render a letter-sized paper preview for
                                    // documents. See [this task][1] for images of the documents we used to figure out
                                    // how much text fills a letter sized paper. We count ~3300 characters and we round
                                    // up to 3500 for some margin of error.
                                    //
                                    // [1]:
                                    //     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/bbw1j3ecf5s7fxrhsfjhthkeg0
                                    newContent.nodeSize > 3500
                                ) {
                                    context.process.waitUntil(
                                        addFeedCandidateEntry(
                                            context,
                                            internalDocument.spaceId,
                                            entry,
                                        ),
                                    );
                                } else {
                                    context.jobs.send(
                                        {
                                            type: "AddFeedCandidateEntry",
                                            jobId: generateId(),
                                            spaceId: internalDocument.spaceId,
                                            entry,
                                        },
                                        {delaySeconds: 5 * 60},
                                    );
                                }
                            }
                        },
                    },
                ),
                DocumentsTable.transactionCreateOrReplaceItem({
                    partitionType: "Document",
                    documentId: documentId,
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: internalDocument.version,
                    steps,
                    invertedSteps,
                    clientId,
                    createdTime: currentTime,
                    // TODO(#bot-attribution): When the actor is a bot, resolve the human account that
                    // triggered the bot action. Currently bot-applied steps will attribute both fields
                    // to the bot's account.
                    accountId: context.actor.getPossiblyBotAccountId(),
                    fromBotAccountId:
                        context.actor.type === "Bot" ? context.actor.getBotAccountId() : null,
                }),
            );
        }

        // If we were instructed to create a comment thread then extend our transaction
        // with entries that will atomically create a new comment thread within the
        // transaction.
        //
        // NOTE(calebmer): There is a limit to how many entries you can have in a DynamoDB
        // transaction. Currently it's 100. This means there's a limit on how many comment
        // threads you can create in an `updateDocumentContent()` call. Reasonable clients
        // should send one at a time. If a client is a bit behind it might send multiple.
        // If a client was offline and comes online and syncs changes, that's when we might
        // hit this limit. It may be reasonable to create comment threads asynchronously
        // instead of in the same transaction to get around this limit should we find users
        // hitting it.
        for (const createCommentThread of createCommentThreads) {
            if (createCommentThread.overrideCreatedTimeForTest) {
                assert(isTestNodeEnvOrAdminScenariosScript);
            }

            const createdTime =
                createCommentThread.overrideCreatedTimeForTest ??
                createCommentThread.createdTime ??
                currentTime;

            transaction.push(
                DocumentsTable.transactionCreateItem({
                    partitionType: "Document",
                    // Assume the new comment thread is referenced. The snapshot update process will
                    // move it if it's not.
                    sortRangeType: "ReferencedCommentThread",
                    documentId: documentId,
                    commentThreadId: createCommentThread.commentThreadId,
                    createdTime,
                    fallbackContentSnippet: null,
                    commentsSummary: {
                        nextCommentIndex: 1,
                        commentCountByAuthorId: new Map([
                            [context.actor.getPossiblyBotAccountId(), 1],
                        ]),
                        mentionCountByAccountId: getMentionCountByAccountIdInContent(
                            createCommentThread.initialCommentContent,
                        ),
                    },
                    resolutionState: {
                        type: "Unresolved",
                    },
                }),
                // Make sure an archive comment thread item also does not exist.
                DocumentsTable.transactionDoesNotExistConditionCheck({
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: documentId,
                    commentThreadId: createCommentThread.commentThreadId,
                }),
                DocumentsTable.transactionCreateOrReplaceItem(
                    {
                        partitionType: "DocumentCommentThread",
                        sortRangeType: "Comments",
                        documentId: documentId,
                        commentThreadId: createCommentThread.commentThreadId,
                        commentIndex: 0,
                        authorId: context.actor.getPossiblyBotAccountId(),
                        createdTime,
                        createdTimeZone: createCommentThread.createdTimeZone,
                        payload: {
                            type: "Content",
                            parent: null,
                            content: createCommentThread.initialCommentContent,
                            contentUpdate: null,
                            fileIds: createCommentThread.initialCommentFileIds,
                            reactionsByPos: emptyMap,
                            filesReactions: emptyReactionSet,
                        },
                    },
                    {
                        onAfterTransactionExecutedSuccessfully: () => {
                            const mentionedAccountIds = getMentionedAccountIdsInContent(
                                createCommentThread.initialCommentContent,
                            );
                            const contentSnippet = getNotificationMessageContentSnippet(
                                createCommentThread.initialCommentContent,
                            );

                            context.jobs.send({
                                type: "NotificationEvent",
                                event: {
                                    type: "CreateDocumentComment",
                                    id: generateChronologicalId(),
                                    spaceId: internalDocument.spaceId,
                                    documentId: documentId,
                                    commentThreadId: createCommentThread.commentThreadId,
                                    commentIndex: 0,
                                    createdTime,
                                    createdTimeZone: createCommentThread.createdTimeZone,
                                    authorId: context.actor.getPossiblyBotAccountId(),
                                    mentionedAccountIds,
                                    parent: null,
                                    isContentSnippetComplete:
                                        contentSnippet.nodeSize ===
                                        createCommentThread.initialCommentContent.nodeSize,
                                    contentSnippet,
                                },
                            });

                            context.jobs.send({
                                type: "IndexSearchEntity",
                                spaceId: internalDocument.spaceId,
                                update: {
                                    type: "DocumentComment",
                                    documentId: documentId,
                                    commentThreadId: createCommentThread.commentThreadId,
                                    commentIndex: 0,
                                    updatedTraits: {type: "Any"},
                                },
                            });
                        },
                    },
                ),
            );
        }

        const updatedCommentThreadItems: Array<DocumentCommentThreadItem> = [];

        if (resolveCommentThreadIds.length > 0) {
            await runAllPromises(
                resolveCommentThreadIds.map(async commentThreadId => {
                    const ranges: Array<AddMarksAfterRemoveAllStepRange> = [];

                    for (const invertedStep of invertedSteps) {
                        if (
                            invertedStep instanceof AddMarksAfterRemoveAllStep &&
                            invertedStep.mark.type.name === "comment" &&
                            invertedStep.mark.attrs.commentThreadId === commentThreadId
                        ) {
                            for (const range of invertedStep.ranges) {
                                ranges.push(range);
                            }
                        }
                    }

                    const commentThreadItem = await getOrSetDefaultMapValue(
                        commentThreadItemPromiseById,
                        commentThreadId,
                        () =>
                            getDocumentCommentThreadItem(context, {
                                documentId: documentId,
                                commentThreadId,
                                // Unresolved comments are likely to be referenced.
                                shouldTryArchiveFirst: false,
                            }),
                    );
                    if (!commentThreadItem)
                        throw new NotFoundError("Couldn\u2019t find document comment thread");

                    // If the comment thread is already resolved, then we don't want to remove the
                    // `ranges` in the resolution state. So leave the comment thread alone. We do need
                    // a condition check to avoid concurrent update issues.
                    if (commentThreadItem.resolutionState.type === "Resolved") {
                        transaction.push(
                            DocumentsTable.transactionUpdateLockVersionConditionCheck(
                                commentThreadItem,
                                commentThreadItem.updateLockVersion,
                            ),
                        );

                        updatedCommentThreadItems.push(commentThreadItem);
                    } else {
                        const newCommentThreadItem: DocumentCommentThreadItem = {
                            ...commentThreadItem,
                            resolutionState: {
                                type: "Resolved",
                                // Because we only allow `RemoveAllMarksStep` steps (or other steps that don't
                                // affect positions) when resolving comments we know our `ranges` are valid for
                                // this version since positions in the document will be the same at the start and
                                // end of this update.
                                version: internalDocument.version + steps.length,
                                ranges,
                            },
                        };

                        transaction.push(
                            DocumentsTable.transactionDirectlyUpdateItem(newCommentThreadItem),
                        );

                        updatedCommentThreadItems.push({
                            ...newCommentThreadItem,
                            updateLockVersion: (newCommentThreadItem.updateLockVersion ?? 0) + 1,
                        });
                    }
                }),
            );
        }

        if (unresolveCommentThreadIds.length > 0) {
            await runAllPromises(
                unresolveCommentThreadIds.map(async commentThreadId => {
                    const commentThreadItem = await getOrSetDefaultMapValue(
                        commentThreadItemPromiseById,
                        commentThreadId,
                        () =>
                            getDocumentCommentThreadItem(context, {
                                documentId: documentId,
                                commentThreadId,
                                // Unresolved comments are likely to be referenced.
                                shouldTryArchiveFirst: true,
                            }),
                    );
                    if (!commentThreadItem)
                        throw new NotFoundError("Couldn\u2019t find document comment thread");

                    if (commentThreadItem.resolutionState.type === "Unresolved") {
                        transaction.push(
                            DocumentsTable.transactionUpdateLockVersionConditionCheck(
                                commentThreadItem,
                                commentThreadItem.updateLockVersion,
                            ),
                        );

                        updatedCommentThreadItems.push(commentThreadItem);
                    } else {
                        const newCommentThreadItem: DocumentCommentThreadItem = {
                            ...commentThreadItem,
                            resolutionState: {
                                type: "Unresolved",
                            },
                        };

                        transaction.push(
                            DocumentsTable.transactionDirectlyUpdateItem(newCommentThreadItem),
                        );

                        updatedCommentThreadItems.push({
                            ...newCommentThreadItem,
                            updateLockVersion: (newCommentThreadItem.updateLockVersion ?? 0) + 1,
                        });
                    }
                }),
            );
        }

        // Append any site transaction entries produced by
        // `validateAccessPolicyUpdateForServer` above. They must be committed in the same
        // dynamo transaction as the document update so the site membership stays
        // consistent with the document's access policy.
        for (const siteEntry of intentionallyUpdatedAccessPolicyTransactionEntries) {
            transaction.push(siteEntry.transactionEntry);
        }

        const execute = async () => {
            if (transaction.length > 0) {
                await RynamoTableSchema.executeTransaction(context, transaction, {
                    clientRequestToken,
                });
            }

            if (steps.length > 0) {
                // Update our cache so that the next update from this process doesn't need to read
                // content from the database.
                await internalDocument.updateCache({
                    newContent,
                    newSteps: steps,
                    newInvertedSteps: invertedSteps,
                    newLastIndexSearchEntityJob,
                    newStepCountByAccountId,
                    newHasAddedFeedCandidateEntry,
                    newDeleted,
                    clientId,
                });
            }
        };

        let updatedCommentThreads: Array<DocumentCommentThreadModel> = [];
        if (updatedCommentThreadItems.length === 0) {
            await execute();
        } else {
            [, updatedCommentThreads] = await runAllPromises([
                execute(),
                runAllPromises(
                    updatedCommentThreadItems.map(commentThreadItem =>
                        createDocumentCommentThreadModelFromItem(
                            context,
                            internalDocument.spaceId,
                            commentThreadItem,
                        ),
                    ),
                ),
            ]);
        }

        return {
            oldVersion: internalDocument.version,
            newVersion: internalDocument.version + steps.length,
            newContent,
            newSteps: steps,
            newInvertedSteps: invertedSteps,
            conflictingSteps,
            updatedCommentThreads,
            siteEventCallbacks: intentionallyUpdatedAccessPolicyTransactionEntries.map(
                entry => entry.getEvent,
            ),
        };
    });

    const {
        oldVersion,
        newVersion,
        newContent,
        newSteps,
        newInvertedSteps,
        conflictingSteps,
        updatedCommentThreads,
        siteEventCallbacks,
    } = result;

    const lastVersionToTriggerSnapshot =
        Math.floor(newVersion / updateDocumentSnapshotAfterStepCount) *
        updateDocumentSnapshotAfterStepCount;

    // Run a snapshot update task about every `updateDocumentSnapshotAfterStepCount`
    // steps.
    if (oldVersion < lastVersionToTriggerSnapshot) {
        context.process.waitUntil(
            updateDocumentSnapshotAfterUpdatingContent(context, {
                id: documentId,
                newVersion,
                newContent,
            }),
        );
    }

    return {
        newVersion,
        newContent,
        newSteps,
        newInvertedSteps,
        conflictingSteps,
        updatedCommentThreads,
        /**
         * Realtime events for any site item / site preview writes that happened in the
         * same dynamo transaction as the document update. Returned as a callback the
         * caller must invoke with a `ServerActionContext` once the transaction has
         * committed — used by the `addEntityToSite` RPC to surface site sidebar events
         * back to the client.
         */
        getRynamoEventsForSite: (
            eventContext: ServerActionContext,
        ): Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>> =>
            runAllPromises(siteEventCallbacks.map(getEvent => getEvent(eventContext))),
    };
}

/**
 * Same as `updateDocumentContent()` but idempotent. If you call this function
 * multiple times with the same input then you'll get the same response.
 */
export async function updateDocumentContentIdempotently(
    context: ServerAccountActionContext,
    options: Parameters<typeof updateDocumentContent>[1] & {clientRequestToken: string},
): Promise<{
    newVersion: number;
    updatedCommentThreads: ReadonlyArray<DocumentCommentThreadModel>;
    eventsForSite: ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>;
}> {
    try {
        const {newVersion, updatedCommentThreads, getRynamoEventsForSite} =
            await updateDocumentContent(context, options);

        const eventsForSite = await getRynamoEventsForSite(context);

        return {newVersion, updatedCommentThreads, eventsForSite};
    } catch (error) {
        if (!isDynamoIdempotentParameterMismatchError(error)) throw error;

        const [documentItem, resolvedCommentThreadItems, unresolvedCommentThreadItems] =
            await runAllPromises([
                getDocumentItemForAuthorization(context, options.id, {
                    consistency: "StrongWithinCache",
                }),
                runAllPromises(
                    (options.resolveCommentThreadIds ?? []).map(commentThreadId =>
                        getDocumentCommentThreadItem(context, {
                            documentId: options.id,
                            commentThreadId,
                            shouldTryArchiveFirst: true,
                            consistency: "StrongWithinCache",
                        }),
                    ),
                ),
                runAllPromises(
                    (options.unresolveCommentThreadIds ?? []).map(commentThreadId =>
                        getDocumentCommentThreadItem(context, {
                            documentId: options.id,
                            commentThreadId,
                            shouldTryArchiveFirst: false,
                            consistency: "StrongWithinCache",
                        }),
                    ),
                ),
            ]);

        const updatedCommentThreads = await runAllPromises(
            [...resolvedCommentThreadItems, ...unresolvedCommentThreadItems].map(
                commentThreadItem =>
                    createDocumentCommentThreadModelFromItem(
                        context,
                        documentItem.spaceId,
                        commentThreadItem,
                    ),
            ),
        );

        // The site transaction entries were committed by the original call — on this
        // idempotent retry we have no way to reconstruct the events, so we return an empty
        // array. The sites RPC caller will still get a usable response; the realtime
        // broadcast for the original call already happened.
        return {
            newVersion: documentItem.version,
            updatedCommentThreads,
            eventsForSite: emptyArray,
        };
    }
}

/**
 * The number of steps between document content snapshots.
 *
 * This isn't the exact number of steps between document content snapshots because
 * we may update the document with more than one step at a time. If we update the
 * document with, say, 10 steps then all 10 new steps will be included in the
 * snapshot regardless of whether we only needed 1 more step for the next snapshot.
 * The next snapshot will also then include fewer steps if we included some extra
 * steps in a given snapshot.
 */
const updateDocumentSnapshotAfterStepCount = 100;

export const updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint =
    new TestCheckpoint<DocumentId>();

export const updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint =
    new TestCheckpoint<DocumentId>();

async function updateDocumentSnapshotAfterUpdatingContent(
    context: DynamoContext,
    {
        id,
        newVersion,
        newContent,
    }: {
        id: DocumentId;
        newVersion: number;
        newContent: DocumentContent;
    },
) {
    const handleSpanName = "Update document snapshot";

    // Since we expect this process to be kind of expensive, we're making this a
    // handler span that sets `context.handle` so we can see the DynamoDB consumed
    // capacity cost associated with snapshot updating.
    await context.tracer.withSpan(`Handle: ${handleSpanName}`, async (context, span) => {
        span.addPropagatedData({
            context: {
                documentId: id,
                handler: handleSpanName,
            },
        });

        const snapshot = await DocumentsTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Document",
                documentId: id,
                sortRangeType: "Snapshot",
            },
            {
                attributes: ["version"],
            },
        );

        // If there is no snapshot, maybe the document was deleted? Ignore. When we try to
        // read the document there will be an error then.
        if (!snapshot) return;

        try {
            // First, update the snapshot. We can't start moving steps until we know the
            // snapshot has successfully updated.
            await DocumentsTable.replaceItem(
                context,
                {
                    partitionType: "Document",
                    documentId: id,
                    sortRangeType: "Snapshot",
                    version: newVersion,
                    content: newContent,
                },
                {
                    condition: {
                        version: snapshot.version,
                    },
                },
            );
        } catch (error) {
            // If some other process concurrently updated the snapshot, then we don't need two
            // processes updating the snapshot at once so we can bail out.
            if (isDynamoConditionCheckError(error)) return;
            throw error;
        }

        await runAllPromises([
            // Move steps from the `StepTransactionsBeforeSnapshot` range to the
            // `StepTransactionsAfterSnapshot` range. So we don't query unnecessary steps when
            // loading our document.
            context.tracer.withSpan("Moving step transactions", async context => {
                // Then, for all steps before our new snapshot version, move them into the
                // `StepTransactionsBeforeSnapshot` range so in the future when we read the full
                // document we don't read those steps.
                const stepTransactions = await arrayFromAsyncIterable(
                    DocumentsTable.query(context, {
                        partitionKey: {
                            partitionType: "Document",
                            documentId: id,
                        },
                        startSortKey: {
                            sortRangeType: "StepTransactionsAfterSnapshot",
                            startVersion: 0,
                        },
                        endSortKey: {
                            sortRangeType: "StepTransactionsAfterSnapshot",
                            startVersion: newVersion - 1,
                        },
                        limit: "All",
                    }),
                );

                // Our writes should be batched under the hood if we dispatch them in parallel like
                // this.
                await runAllPromises(
                    stepTransactions.map(async stepTransaction => {
                        await DocumentsTable.createOrReplaceItem(context, {
                            ...stepTransaction,
                            sortRangeType: "StepTransactionsBeforeSnapshot",
                        });

                        await updateDocumentSnapshotBeforeDeletingStepsTestCheckpoint.waitForTest(
                            id,
                        );

                        // It's important that we wait for our put in the `StepTransactionsBeforeSnapshot`
                        // to successfully complete before we delete.
                        await DocumentsTable.deleteItemWithKeyIfExists(context, stepTransaction);
                    }),
                );
            }),

            // Archive comment threads that are no longer referenced in the document so we
            // don't query them when loading our document.
            context.tracer.withSpan("Reconciling referenced comment threads", async () => {
                const actualReferencedCommentThreadIds =
                    getReferencedDocumentCommentThreadIds(newContent);

                const expectedReferencedCommentThreadItems = await arrayFromAsyncIterable(
                    DocumentsTable.query(context, {
                        partitionKey: {
                            partitionType: "Document",
                            documentId: id,
                        },
                        startSortKey: {
                            sortRangeType: "ReferencedCommentThread",
                            commentThreadId: getMinId<DocumentCommentThreadId>(),
                        },
                        endSortKey: {
                            sortRangeType: "ReferencedCommentThread",
                            commentThreadId: getMaxId<DocumentCommentThreadId>(),
                        },
                        limit: "All",
                    }),
                );

                const expectedReferencedCommentThreadIds = new Set(
                    expectedReferencedCommentThreadItems.map(
                        ({commentThreadId}) => commentThreadId,
                    ),
                );

                await runAllPromises([
                    // Move from `ReferencedCommentThread` to `ArchivedCommentThread`:
                    ...mapIterable(
                        expectedReferencedCommentThreadItems,
                        async expectedReferencedCommentThreadItem => {
                            // Yay! This comment thread is actually referenced in the document. Otherwise we
                            // need to archive the comment thread.
                            if (
                                actualReferencedCommentThreadIds.has(
                                    expectedReferencedCommentThreadItem.commentThreadId,
                                )
                            ) {
                                return;
                            }

                            let hasAttempted = false;

                            await context.dynamo.retryTransaction(async context => {
                                const isInitialAttempt = !hasAttempted;
                                hasAttempted = true;

                                // If we are retrying then load the latest comment thread item. We are probably
                                // retrying because the update lock version was changed.
                                const referencedCommentThreadItem = isInitialAttempt
                                    ? expectedReferencedCommentThreadItem
                                    : await DocumentsTable.getItemIfExists(
                                          context,
                                          expectedReferencedCommentThreadItem,
                                      );

                                // If we can't find the referenced comment thread when retrying then a concurrent
                                // writer probably moved it.
                                if (!referencedCommentThreadItem) return;

                                await updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.waitForTest(
                                    id,
                                );

                                // We move the comment thread in a transaction so only one version of the item
                                // exists at any given time. Since we need to make updates to the item it would be
                                // weird of two versions of the item exist at once and one has an update applied.
                                // How do we make sure that update is not lost? Or the history doesn't fork?
                                await DynamoTableSchema.executeTransaction(context, [
                                    DocumentsTable.transactionDeleteItem(
                                        referencedCommentThreadItem,
                                    ),
                                    DocumentsTable.transactionCreateOrReplaceItem({
                                        ...referencedCommentThreadItem,
                                        sortRangeType: "ArchivedCommentThread",
                                    }),
                                ]);
                            });
                        },
                    ),

                    // Move from `ArchivedCommentThread` to `ReferencedCommentThread`:
                    ...mapIterable(
                        actualReferencedCommentThreadIds,
                        async actualReferencedCommentThreadId => {
                            // Yay! This comment thread is in our referenced comment threads sort range. We
                            // don't have to move it from the archived comment threads sort range.
                            if (
                                expectedReferencedCommentThreadIds.has(
                                    actualReferencedCommentThreadId,
                                )
                            ) {
                                return;
                            }

                            await context.dynamo.retryTransaction(async context => {
                                const archivedCommentThreadItem =
                                    await DocumentsTable.getItemIfExists(context, {
                                        partitionType: "Document",
                                        sortRangeType: "ArchivedCommentThread",
                                        documentId: id,
                                        commentThreadId: actualReferencedCommentThreadId,
                                    });

                                // If there is no referenced or archived comment thread item then the comment
                                // thread may have never existed. Or a concurrent writer moved it.
                                if (!archivedCommentThreadItem) return;

                                await updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.waitForTest(
                                    id,
                                );

                                // We move the comment thread in a transaction so only one version of the item
                                // exists at any given time. Since we need to make updates to the item it would be
                                // weird of two versions of the item exist at once and one has an update applied.
                                // How do we make sure that update is not lost? Or the history doesn't fork?
                                await DynamoTableSchema.executeTransaction(context, [
                                    DocumentsTable.transactionDeleteItem(archivedCommentThreadItem),
                                    DocumentsTable.transactionCreateOrReplaceItem({
                                        ...archivedCommentThreadItem,
                                        sortRangeType: "ReferencedCommentThread",
                                    }),
                                ]);
                            });
                        },
                    ),
                ]);
            }),
        ]);
    });
}

/**
 * Force an update of the document's snapshot in a test environment.
 */
export async function updateDocumentSnapshotForTest(
    context: ServerActionContext,
    documentId: DocumentId,
): Promise<void> {
    assert(import.meta.jest);

    const document = await getInternalDocumentIfExists(context, documentId);
    if (!document) throw createDocumentNotFoundError(documentId);

    await updateDocumentSnapshotAfterUpdatingContent(context, {
        id: documentId,
        newVersion: document.version,
        newContent: document.content,
    });
}

export const getDocumentContentStepsTestCounter = new TestCounter<{
    id: DocumentId;
    startVersion: number;
    endVersion: number;
}>();

/**
 * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
 */
export async function getDocumentContentSteps(
    context: ServerActionContext,
    {
        id,
        startVersion,
        endVersion,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
) {
    const documentItem = await getDocumentItemForAuthorizationIfExists(context, id);
    if (!documentItem) throw new NotFoundError("Document does not exist");

    // This function requires comment access level since we may return steps that add
    // comments to the document and viewers can't see comment ranges on a document.
    await authorizeDocumentItemAccess(context, documentItem, "Comment");

    if (startVersion < 0) throw new InvalidArgumentError("Start version is less than zero");
    if (startVersion > endVersion)
        throw new InvalidArgumentError("Start version is greater than end version");
    if (startVersion === endVersion)
        throw new InvalidArgumentError("Start version is equal to end version");
    if (endVersion > documentItem.version)
        throw new FailedPreconditionError(
            "End version is greater than the last version in the document",
        );

    getDocumentContentStepsTestCounter.incrementForTest({id, startVersion, endVersion});

    return await getDocumentContentStepsBetweenValidatedVersionRange(context, {
        id,
        startVersion,
        endVersion,
    });
}

/**
 * Reads all steps between `startVersion` (inclusive) and `endVersion` (exclusive).
 *
 * We assume you have checked that `endVersion` is a version that exists! We will
 * throw a `DataLossError` if we don't find steps up to `endVersion`.
 *
 * We also assert that `versionStart` is less than `endVersion` and `versionStart`
 * is greater than zero.
 *
 * We call this function "for validated version range" because we assume
 * `versionStart` and `endVersion` are valid.
 *
 * We start by looking in the `StepsBeforeSnapshot` range since it has all our
 * historical steps. If we can't find all the steps we need then we check the
 * `StepsAfterSnapshot` range.
 */
async function getDocumentContentStepsBetweenValidatedVersionRange(
    context: DynamoContext,
    options: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
): Promise<Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>> {
    return await context.tracer.withSpan("Get document content steps", async (context, span) => {
        span.addData({
            content: {
                collaborative: {
                    startVersion: options.startVersion,
                    endVersion: options.endVersion,
                },
            },
        });

        const {branch, steps} =
            await getDocumentContentStepsBetweenValidatedVersionRangeWithoutSpan(context, options);

        // This function has a couple different code branches that handle various edge
        // cases. It's useful for debugging to know exactly which branch the function took.
        // So record the executed branch in our span.
        span.addData({common: {branch}});

        return steps;
    });
}

async function getDocumentContentStepsBetweenValidatedVersionRangeWithoutSpan(
    context: DynamoContext,
    {
        id,
        startVersion,
        endVersion,
    }: {
        id: DocumentId;
        startVersion: number;
        endVersion: number;
    },
): Promise<{
    branch:
        | "ShortCircuitStepsAfterSnapshot"
        | "ShortCircuitStepsBeforeSnapshot"
        | "StepsAfterSnapshot"
        | "StepsAfterSnapshotWithStrongConsistency"
        | "StepsAfterSnapshotMovedBeforeSnapshot"
        | "StepsBeforeSnapshot"
        | "StepsBeforeSnapshotWithStrongConsistency";
    steps: Array<{step: Step; invertedStep: Step; clientId: ContentEditorClientId}>;
}> {
    assert(Number.isSafeInteger(startVersion));
    assert(Number.isSafeInteger(endVersion));
    assert(startVersion < endVersion);
    assert(startVersion >= 0);

    const stepByVersion = new Map<
        number,
        {step: Step; invertedStep: Step; clientId: ContentEditorClientId}
    >();

    const processStepTransaction = (stepTransaction: DocumentStepTransactionItem) => {
        for (let i = 0; i < stepTransaction.steps.length; i++) {
            const version = stepTransaction.startVersion + i;
            const step = stepTransaction.steps[i]!;
            const invertedStep = stepTransaction.invertedSteps[i];
            if (!invertedStep) throw new DataLossError("Missing inverted document step");

            // We may get steps outside of the version range because they are in a transaction
            // that intersects with our version range. Don't set those steps to our map.
            if (startVersion <= version && version < endVersion) {
                stepByVersion.set(version, {
                    step,
                    invertedStep,
                    clientId: stepTransaction.clientId,
                });
            }
        }
    };

    const getSteps = () => {
        const steps = [];

        for (let version = startVersion; version < endVersion; version++) {
            const step = stepByVersion.get(version);
            if (!step) return null;
            steps.push(step);
        }

        return steps;
    };

    const stepTransactionContainingStartVersion =
        await getDocumentStepTransactionContainingValidatedVersion(context, id, startVersion);

    processStepTransaction(stepTransactionContainingStartVersion);

    // If the transaction containing our start version also contains our end version
    // then we're done!
    //
    // As an optimization, we could start the request to get
    // `stepTransactionContainingEndVersion` AFTER this short circuit so that if we
    // only need one transaction we don't need to make the extra requests. However, we
    // expect most of the time when you call this function you need more than one
    // transaction.
    if (
        endVersion <=
        stepTransactionContainingStartVersion.startVersion +
            stepTransactionContainingStartVersion.steps.length
    ) {
        const steps = getSteps();
        if (!steps) throw new DataLossError("Missing a document step");
        switch (stepTransactionContainingStartVersion.sortRangeType) {
            case "StepTransactionsAfterSnapshot":
                return {branch: "ShortCircuitStepsAfterSnapshot", steps};
            case "StepTransactionsBeforeSnapshot":
                return {branch: "ShortCircuitStepsBeforeSnapshot", steps};
            default:
                throw exhaustive(stepTransactionContainingStartVersion);
        }
    }

    switch (stepTransactionContainingStartVersion.sortRangeType) {
        // If we start in the after snapshot range then we will also end in the after
        // snapshot range.
        case "StepTransactionsAfterSnapshot": {
            const queryStepTransactions = async (consistency: DynamoReadConsistency) => {
                for await (const stepTransaction of DocumentsTable.query(context, {
                    consistency,
                    partitionKey: {
                        partitionType: "Document",
                        documentId: id,
                    },
                    startSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion:
                            stepTransactionContainingStartVersion.startVersion +
                            stepTransactionContainingStartVersion.steps.length,
                    },
                    endSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion: endVersion - 1,
                    },
                    limit: "All",
                })) {
                    processStepTransaction(stepTransaction);
                }
            };

            await queryStepTransactions("Eventual");

            {
                const steps = getSteps();
                if (steps) return {branch: "StepsAfterSnapshot", steps};
            }

            // If we couldn't find all the request steps then try querying again with strong
            // read consistency. Given this range has been validated we know the version range
            // MUST exist in the document. So if we don't have all the steps it's probably due
            // to an eventual consistency lag.
            //
            // We find eventual consistency lag is rare enough in practice that it's cheaper to
            // retry with strong consistency after a failed eventually consistent read then to
            // always make strong consistency reads.
            //
            // It's ok to call `processStepTransaction()` twice for step transactions we've
            // already seen.
            await queryStepTransactions("Strong");

            {
                const steps = getSteps();
                if (steps) return {branch: "StepsAfterSnapshotWithStrongConsistency", steps};
            }

            // If we still can't find the steps in the `StepTransactionsBeforeSnapshot` sort
            // range when reading with strong consistency then it's possible we're updating the
            // document snapshot and we read the first step transaction item BEFORE the
            // snapshot moved all steps from the `StepTransactionsAfterSnapshot` sort range to
            // the `StepTransactionsBeforeSnapshot` sort range. Therefore, querying
            // `StepTransactionsAfterSnapshot` will never produce results since all the steps
            // have been deleted. So try one last strong consistency query in the
            // `StepTransactionsBeforeSnapshot` sort range.
            for await (const stepTransaction of DocumentsTable.query(context, {
                consistency: "Strong",
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion:
                        stepTransactionContainingStartVersion.startVersion +
                        stepTransactionContainingStartVersion.steps.length,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: endVersion - 1,
                },
                limit: "All",
            })) {
                processStepTransaction(stepTransaction);
            }

            {
                const steps = getSteps();
                if (!steps) throw new DataLossError("Missing a document step");
                return {branch: "StepsAfterSnapshotMovedBeforeSnapshot", steps};
            }
        }
        // If we start in the before snapshot range then we might not have all the steps we
        // need in the before snapshot range. So query the before snapshot range and then
        // determine if we also need to query the after snapshot range.
        case "StepTransactionsBeforeSnapshot": {
            const queryStepTransactions = async (consistency: DynamoReadConsistency) => {
                const stepTransactionBeforeSnapshotIterator = DocumentsTable.query(context, {
                    consistency,
                    partitionKey: {
                        partitionType: "Document",
                        documentId: id,
                    },
                    startSortKey: {
                        sortRangeType: "StepTransactionsBeforeSnapshot",
                        startVersion:
                            stepTransactionContainingStartVersion.startVersion +
                            stepTransactionContainingStartVersion.steps.length,
                    },
                    endSortKey: {
                        sortRangeType: "StepTransactionsBeforeSnapshot",
                        startVersion: endVersion - 1,
                    },
                    limit: "All",
                });

                let lastStepTransactionBeforeSnapshot = null;

                for await (const stepTransaction of stepTransactionBeforeSnapshotIterator) {
                    lastStepTransactionBeforeSnapshot = stepTransaction;
                    processStepTransaction(stepTransaction);
                }

                // If the last step transaction we found in the before snapshot range contains the
                // end version then we're done! Otherwise we need to continue querying in the after
                // snapshot range.
                if (
                    lastStepTransactionBeforeSnapshot &&
                    endVersion <=
                        lastStepTransactionBeforeSnapshot.startVersion +
                            lastStepTransactionBeforeSnapshot.steps.length
                ) {
                    return;
                }

                const stepTransactionAfterSnapshotIterator = DocumentsTable.query(context, {
                    consistency,
                    partitionKey: {
                        partitionType: "Document",
                        documentId: id,
                    },
                    startSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion:
                            stepTransactionContainingStartVersion.startVersion +
                            stepTransactionContainingStartVersion.steps.length,
                    },
                    endSortKey: {
                        sortRangeType: "StepTransactionsAfterSnapshot",
                        startVersion: endVersion - 1,
                    },
                    limit: "All",
                });

                for await (const stepTransactionAfterSnapshot of stepTransactionAfterSnapshotIterator) {
                    processStepTransaction(stepTransactionAfterSnapshot);
                }
            };

            await queryStepTransactions("Eventual");

            {
                const steps = getSteps();
                if (steps) return {branch: "StepsBeforeSnapshot", steps};
            }

            // If we couldn't find all the request steps then try querying again with strong
            // read consistency. Given this range has been validated we know the version range
            // MUST exist in the document. So if we don't have all the steps it's probably due
            // to an eventual consistency lag.
            //
            // We find eventual consistency lag is rare enough in practice that it's cheaper to
            // retry with strong consistency after a failed eventually consistent read then to
            // always make strong consistency reads.
            //
            // It's ok to call `processStepTransaction()` twice for step transactions we've
            // already seen.
            await queryStepTransactions("Strong");

            {
                const steps = getSteps();
                if (!steps) throw new DataLossError("Missing a document step");
                return {branch: "StepsBeforeSnapshotWithStrongConsistency", steps};
            }
        }
        default:
            throw exhaustive(stepTransactionContainingStartVersion);
    }
}

/**
 * Get the step transaction which contains `version` in the provided document.
 *
 * Throws a `DataLossError` if the `version` does not exist in the document. You're
 * responsible for validating that `version` exists in the document before calling
 * this function. Hence why the name says "validated" version.
 */
// Given the way we layout our documents table, we can't query
// `transaction.startVersion = version`. Since a transaction may contain multiple
// steps and hence multiple versions. We don't know where the transaction
// boundaries lie without querying the table.
//
// Given the way DynamoDB works we also can't query
// `transaction.startVersion >= version AND version < transaction.startVersion + transaction.steps.length`
// since we have to query on sort keys (of which `transaction.steps` is not a part
// of).
//
// So the way this function is implemented is:
//
// 1. We query the `StepTransactionsBeforeSnapshot` sort range for the transaction
//    containing this version.
// 2. We query the `StepTransactionsAfterSnapshot` sort range for the transaction
//    containing this version.
//
// To query those sort ranges, we use
// `transaction.startVersion BETWEEN 0 AND version` in reverse with a limit of one.
// The first transaction in that range should contain our version.
async function getDocumentStepTransactionContainingValidatedVersion(
    context: DynamoContext,
    id: DocumentId,
    version: number,
): Promise<DocumentStepTransactionItem> {
    assert(Number.isSafeInteger(version));

    const queryStepTransactionsBeforeSnapshot = async (consistency: DynamoReadConsistency) => {
        // Find the transaction which contains `version`. To do this, we need to query
        // `transaction.startVersion BETWEEN 0 AND version` in descending order and return
        // the first transaction we find.
        //
        // To understand why this works consider two cases:
        //
        // 1. The step for `version` is the first step of a transaction (the transaction's
        //    `startVersion`).
        // 2. The step for `version` is in the middle of some transaction.
        //
        // Now consider the following four transactions in the
        // `StepTransactionsBeforeSnapshot` sort range:
        //
        // ```
        // transaction1: startVersion = 0
        // transaction2: startVersion = 5
        // transaction3: startVersion = 6
        // transaction4: startVersion = 9
        // ```
        //
        // For case 1: We want to get a range of steps starting at version 6. So we query
        // `transaction.startVersion BETWEEN 0 AND 6` in descending order. The last
        // transaction in this range is `transaction3` which contains version 6 so we're
        // good.
        //
        // For case 2: We want to get a range of steps starting at version 8. So we query
        // `transaction.startVersion BETWEEN 0 AND 8` in descending order. The last
        // transaction in this range is `transaction3` which contains version 8 so we're
        // good.
        const stepTransactionBeforeSnapshotContainingVersionArray = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                consistency,
                limit: 1,
                descending: true,
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: 0,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsBeforeSnapshot",
                    startVersion: version,
                },
            }),
        );

        assert(stepTransactionBeforeSnapshotContainingVersionArray.length <= 1);
        const stepTransactionBeforeSnapshotContainingVersion =
            stepTransactionBeforeSnapshotContainingVersionArray[0];

        if (!stepTransactionBeforeSnapshotContainingVersion) return null;

        const actuallyContainsVersion =
            stepTransactionBeforeSnapshotContainingVersion.startVersion <= version &&
            version <
                stepTransactionBeforeSnapshotContainingVersion.startVersion +
                    stepTransactionBeforeSnapshotContainingVersion.steps.length;

        // The last transaction in our `transaction.startVersion BETWEEN 0 AND version`
        // range might not actually contain the version we are looking for!
        //
        // This will happen if `version` is after the snapshot version.
        //
        // Since in our `StepTransactionsBeforeSnapshot` sort range we will have
        // transactions from version 0 to the snapshot version. So if `version` is after
        // the snapshot version then we will return the first transaction after the
        // snapshot version.
        if (!actuallyContainsVersion) return null;

        return stepTransactionBeforeSnapshotContainingVersion;
    };

    const queryStepTransactionsAfterSnapshot = async (consistency: DynamoReadConsistency) => {
        // Same as the query above but on the `StepTransactionsAfterSnapshot` sort range
        // instead of the `StepTransactionsBeforeSnapshot` sort range.
        const stepTransactionAfterSnapshotContainingVersionArray = await arrayFromAsyncIterable(
            DocumentsTable.query(context, {
                consistency,
                limit: 1,
                descending: true,
                partitionKey: {
                    partitionType: "Document",
                    documentId: id,
                },
                startSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: 0,
                },
                endSortKey: {
                    sortRangeType: "StepTransactionsAfterSnapshot",
                    startVersion: version,
                },
            }),
        );

        assert(stepTransactionAfterSnapshotContainingVersionArray.length <= 1);
        const stepTransactionAfterSnapshotContainingVersion =
            stepTransactionAfterSnapshotContainingVersionArray[0];
        if (!stepTransactionAfterSnapshotContainingVersion) return null;

        const actuallyContainsVersion =
            stepTransactionAfterSnapshotContainingVersion.startVersion <= version &&
            version <
                stepTransactionAfterSnapshotContainingVersion.startVersion +
                    stepTransactionAfterSnapshotContainingVersion.steps.length;

        // The last transaction in our `transaction.startVersion BETWEEN 0 AND version`
        // range might not actually contain the version we are looking for!
        //
        // This will happen while we are updating the snapshot.
        //
        // Consider two adjacent transactions, `transaction1` and `transaction2`.
        // `transaction1` comes before `transaction2`. The version we are looking for is in
        // `transaction2`. But our query will give us `transaction1` if we are in the
        // following state:
        //
        // 1. We deleted `transaction2` from `StepTransactionsAfterSnapshot` and moved it
        //    to `StepTransactionsBeforeSnapshot`.
        // 2. We have not yet deleted `transaction1` from `StepTransactionsAfterSnapshot`.
        //
        // In this case we need to scan `StepTransactionsBeforeSnapshot` for `transaction2`
        // which.
        if (!actuallyContainsVersion) return null;

        return stepTransactionAfterSnapshotContainingVersion;
    };

    {
        const [stepTransactionBeforeSnapshot, stepTransactionAfterSnapshot] = await runAllPromises([
            queryStepTransactionsBeforeSnapshot("Eventual"),
            queryStepTransactionsAfterSnapshot("Eventual"),
        ]);

        // If we have both `stepTransactionBeforeSnapshot` and
        // `stepTransactionAfterSnapshot` then return the transaction from before the
        // snapshot since that's the new canonical transaction and we'll soon delete the
        // step transaction after the snapshot.
        if (stepTransactionBeforeSnapshot) return stepTransactionBeforeSnapshot;
        if (stepTransactionAfterSnapshot) return stepTransactionAfterSnapshot;
    }

    // Given this is a validated document version we know a step transaction containing
    // the step MUST exist. So try reading again but with strong consistency since we
    // might not have found the step transaction due to eventual consistency lag.
    //
    // Retrying with strong consistency is cheaper than always using strong consistency
    // because we've found in practice eventually consistency lags are pretty rare (1
    // in 10,000).
    {
        const [stepTransactionBeforeSnapshot, stepTransactionAfterSnapshot] = await runAllPromises([
            queryStepTransactionsBeforeSnapshot("Strong"),
            queryStepTransactionsAfterSnapshot("Strong"),
        ]);

        // If we have both `stepTransactionBeforeSnapshot` and
        // `stepTransactionAfterSnapshot` then return the transaction from before the
        // snapshot since that's the new canonical transaction and we'll soon delete the
        // step transaction after the snapshot.
        if (stepTransactionBeforeSnapshot) return stepTransactionBeforeSnapshot;
        if (stepTransactionAfterSnapshot) return stepTransactionAfterSnapshot;
    }

    throw new DataLossError("Could not find step transaction containing step");
}

export const getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint =
    new TestCheckpoint<DocumentId>();

/**
 * A document comment thread could either be in the referenced or archived sort
 * range.
 *
 * This function should not be exported! It does not implement authorization.
 */
async function getDocumentCommentThreadItemIfExists(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        shouldTryArchiveFirst = false,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        /**
         * Performance optimization hint to try reading from the `ArchivedCommentThread`
         * range before the `ReferencedCommentThread` range.
         */
        shouldTryArchiveFirst?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<DocumentCommentThreadItem | null> {
    {
        const commentThreadItem = await DocumentsTable.getItemIfExists(
            context,
            {
                partitionType: "Document",
                sortRangeType: !shouldTryArchiveFirst
                    ? "ReferencedCommentThread"
                    : "ArchivedCommentThread",
                documentId,
                commentThreadId,
            },
            {consistency},
        );
        if (commentThreadItem) return commentThreadItem;
    }

    await getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint.waitForTest(documentId);

    {
        const commentThreadItem = await DocumentsTable.getItemIfExists(
            context,
            {
                partitionType: "Document",
                sortRangeType: !shouldTryArchiveFirst
                    ? "ArchivedCommentThread"
                    : "ReferencedCommentThread",
                documentId,
                commentThreadId,
            },
            {consistency},
        );
        if (commentThreadItem) return commentThreadItem;
    }

    // If we could not find the comment thread in two separate `getItem()`s, then try a
    // transaction that reads both at once. This way we support the case where a
    // transaction was committed between our two `getItem()` requests moving the thread
    // from one range to another.
    {
        const [commentThreadItem1, commentThreadItem2] =
            await DocumentsTable.executeGetItemsTransaction(context, [
                {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId,
                    commentThreadId,
                },
                {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId,
                    commentThreadId,
                },
            ]);
        if (commentThreadItem1) return commentThreadItem1;
        if (commentThreadItem2) return commentThreadItem2;
        return null;
    }
}

async function getDocumentCommentThreadItem(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        shouldTryArchiveFirst,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        shouldTryArchiveFirst?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
) {
    const item = await getDocumentCommentThreadItemIfExists(context, {
        documentId,
        commentThreadId,
        shouldTryArchiveFirst,
        consistency,
    });
    if (!item) throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);
    return item;
}

/**
 * Add a new comment to a document comment thread.
 */
export async function createDocumentComment(
    context: ServerAccountActionContext,
    {
        documentId,
        commentThreadId,
        parent,
        content,
        createdTimeZone,
        overrideCreatedTimeForTest,
        fileIds,
        isStream,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        createdTimeZone: TimeZone;
        overrideCreatedTimeForTest?: Date;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        isStream?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    index: number;
    createdTime: Date;
}> {
    if (overrideCreatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    return await context.dynamo.retryTransaction(async context => {
        const [{spaceId, documentAccessPolicy}, commentThreadItem, parentForEvent] =
            await runAllPromises([
                (async () => {
                    const {spaceId, accessPolicy: documentAccessPolicy} =
                        await authorizeDocumentAccess(context, documentId, "Comment", {
                            consistency,
                        });

                    // Make sure all the provided files exist.
                    await runAllPromises(
                        fileIds.map(fileId =>
                            isId<FileId>(fileId)
                                ? getFileFromAttachment(
                                      context,
                                      fileId,
                                      FileDocumentAuthorizer.bind({
                                          type: "DocumentComments",
                                          documentId,
                                      }),
                                      {consistency},
                                  )
                                : null,
                        ),
                    );

                    return {spaceId, documentAccessPolicy};
                })(),
                getDocumentCommentThreadItemIfExists(context, {
                    documentId,
                    commentThreadId,
                    consistency,
                }),
                (async (): Promise<ApiBotWebhookNewMessageEventParent | null> => {
                    if (!parent) return null;

                    switch (parent.type) {
                        case "Message": {
                            const commentItem = await DocumentsTable.getItem(
                                context,
                                {
                                    partitionType: "DocumentCommentThread",
                                    sortRangeType: "Comments",
                                    documentId,
                                    commentThreadId,
                                    commentIndex: parent.index,
                                },
                                {consistency},
                            );
                            return {
                                type: "Message",
                                index: parent.index,
                                author: {id: commentItem.authorId},
                            };
                        }
                        case "MessagesRange": {
                            const commentItems = await arrayFromAsyncIterable(
                                runCommentsQuery(context, {
                                    cache: DocumentCommentItemContextCache,
                                    cacheKeyPrefix: `${documentId}-${commentThreadId}`,
                                    consistency,
                                    startIndex: parent.startIndex,
                                    endIndex: parent.endIndex,
                                    query: ({consistency, limit, startSortKey, endSortKey}) =>
                                        DocumentsTable.query(context, {
                                            consistency,
                                            limit,
                                            partitionKey: {
                                                partitionType: "DocumentCommentThread",
                                                documentId,
                                                commentThreadId,
                                            },
                                            startSortKey,
                                            endSortKey,
                                        }),
                                }),
                            );

                            validateMessageContentPayloadMessagesRangeParent(parent, commentItems);

                            return {
                                type: "Message",
                                index: parent.startIndex,
                                author: {id: commentItems[0]!.authorId},
                            };
                        }
                        case "PostRange": {
                            throw new InvalidArgumentError(
                                "Post range parent can only be used with post comments",
                            );
                        }
                        default:
                            throw exhaustive(parent);
                    }
                })(),
            ]);

        if (!commentThreadItem)
            throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const currentTime = new Date(Date.now());

        const createdTime = overrideCreatedTimeForTest ?? currentTime;

        // If this is a stream message and we have empty content then we only send a
        // notification event after the first content part has finished.
        const willSendNotificationEvent = !isStream || !isContentEmpty(content);

        const commentIndex = commentThreadItem.commentsSummary.nextCommentIndex;
        const authorId = context.actor.getPossiblyBotAccountId();

        if (isStream && context.actor.type !== "Bot") {
            throw new PermissionDeniedError("Only bots can send `Stream` messages");
        }

        const newCommentCountByAuthorId = new Map(
            commentThreadItem.commentsSummary.commentCountByAuthorId,
        );
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentThreadItem.commentsSummary.mentionCountByAccountId,
            null,
            content,
        );

        await DynamoTableSchema.executeTransaction(context, [
            DocumentsTable.transactionCreateItem(
                {
                    partitionType: "DocumentCommentThread",
                    sortRangeType: "Comments",
                    documentId,
                    commentThreadId,
                    commentIndex,
                    authorId,
                    createdTime,
                    createdTimeZone,
                    payload: {
                        type: "Content",
                        parent,
                        content,
                        contentUpdate: null,
                        fileIds,
                        clerical: isStream ? {type: "Stream"} : undefined,
                        reactionsByPos: emptyMap,
                        filesReactions: emptyReactionSet,
                    },
                },
                // Retry in case of a race condition where another process writes to this
                // `commentIndex` before us.
                {isConditionCheckErrorRetriable: true},
            ),
            DocumentsTable.transactionDirectlyUpdateItemAttribute(
                commentThreadItem,
                "commentsSummary",
                {
                    nextCommentIndex: commentThreadItem.commentsSummary.nextCommentIndex + 1,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: commentThreadItem.updateLockVersion},
            ),

            // If this is a stream comment then create the stream state item. Create-or-replace
            // is safe since we know the comment index doesn't exist from our other condition
            // checks.
            ...(isStream
                ? [
                      DocumentsTable.transactionCreateOrReplaceItem({
                          partitionType: "DocumentCommentThread",
                          sortRangeType: "Comments#Stream",
                          documentId,
                          commentThreadId,
                          commentIndex,
                          authorId,
                          createdTime,
                          createdTimeZone,
                          completedTime: null,
                          partCount: 0,
                          lastPartUpdateLockVersion: null,
                          lastPartCreatedTime: null,
                          lastPingTime: null,
                          lastIndexSearchEntityJob: {
                              sendTime: currentTime,
                              delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
                          },
                          pendingNotificationEvent: !willSendNotificationEvent
                              ? {parent: parentForEvent}
                              : null,
                      }),
                  ]
                : []),
        ]);

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);
        const contentSnippet = getNotificationMessageContentSnippet(content);

        if (willSendNotificationEvent) {
            context.jobs.send({
                type: "NotificationEvent",
                event: {
                    type: "CreateDocumentComment",
                    id: generateChronologicalId(),
                    spaceId,
                    documentId,
                    commentThreadId,
                    commentIndex,
                    createdTime,
                    createdTimeZone,
                    authorId,
                    mentionedAccountIds,
                    parent: parentForEvent,
                    isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                    contentSnippet,
                },
            });
        }

        context.jobs.send(
            {
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex,
                    updatedTraits: {type: "Any"},
                },
            },
            {delaySeconds: isStream ? messageStreamIndexSearchEntityDelaySeconds : 0},
        );

        // Only increase affinity score if we have a session actor. Don't increase affinity
        // score if this is a system actor sending a message on behalf of an account.
        if (context.actor.type === "Session") {
            const sessionContext = context.actor.authorizeSession();

            context.process.waitUntil(
                markSearchAffinityEntityInteraction(sessionContext, {
                    spaceId,
                    entityId: `Document:${documentId}`,
                    interaction: {type: "MediumIntentUpdate"},
                    siteId: getSiteIdFromAccessPolicyIfExists(documentAccessPolicy),
                }),
            );

            // Increase affinity points for all mentioned accounts with a high intent update
            // since the user clearly wants the attention of the mentioned accounts.
            //
            // (If a mentioned account doesn't have access to this message should that still be
            // a high intent update? For now we say yes since the user is explicitly choosing
            // to reference them.)
            for (const mentionedAccountId of mentionedAccountIds) {
                context.process.waitUntil(async () => {
                    if (await isAccountMemberOfSpace(context, spaceId, mentionedAccountId)) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                            // Accounts cannot live in a site.
                            siteId: null,
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
 * stream can update the stream. A bot can only create new parts or update the last
 * part of the stream.
 *
 * Currently, you completely replace a part when you update it. We may allow more
 * granular part updates in the future.
 */
// NOTE(ifitzsimmons, 2026-07-16): This function adds/updates a part of the message
// stream and broadcasts an event to all connected clients. Stream parts can/should
// only be added in two scenarios:
//
// 1. A bot is sending a message via our API.
// 2. We've detected that a message stream has timed out and we're completing the
//    stream with an error message.
export function putDocumentCommentStreamPartAndBroadcastEvent(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        partIndex,
        payload,
        consistency,
        isTimeoutErrorCompletion = false,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        partIndex: number | "Create";
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
        isTimeoutErrorCompletion?: boolean;
    },
): Promise<{spaceId: SpaceId; createdTime: Date}> {
    if (isTimeoutErrorCompletion && context.actor.type !== "System") {
        throw new PermissionDeniedError(
            "Only system actors can complete a message stream after timeout",
        );
    }

    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeDocumentAccess(context, documentId, "Comment", {consistency}),

            DocumentsTable.getItemIfExists(
                context,
                {
                    partitionType: "DocumentCommentThread",
                    sortRangeType: "Comments#Stream",
                    documentId,
                    commentThreadId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        let completedTime = item.completedTime;

        if (completedTime !== null) {
            // If the stream is already completed then noop.
            if (isTimeoutErrorCompletion) return {spaceId, createdTime: new Date()};

            throw new FailedPreconditionError("The stream has already been completed", {
                displayMessage: errorDisplayMessage`The stream has already been completed.`,
            });
        }

        if (!isTimeoutErrorCompletion && hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantWriteToStaleMessageStreamError();
        }

        if (partIndex === "Create") {
            partIndex = item.partCount;
        }

        // Use `Date.now()` so tests can mock the `Date.now()` function.
        const currentTime = new Date(Date.now());

        completedTime ??=
            isTimeoutErrorCompletion || payload.type === "ExperimentalApprovals"
                ? currentTime
                : null;

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        let version: number;

        let createdTime: Date;
        if (partIndex === item.partCount) {
            const notificationEvent = await getNotificationEventForPutDocumentCommentStreamPart(
                context,
                {
                    spaceId,
                    documentId,
                    commentThreadId,
                    commentIndex,
                    item,
                    payload,
                    partIndex,
                    isTimeoutErrorCompletion,
                },
            );

            createdTime = currentTime;

            const createPartTransactionEntry = DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments#StreamPart",
                documentId,
                commentThreadId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                DocumentsTable.transactionDirectlyUpdateItem({
                    ...item,
                    completedTime,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastPartCreatedTime: createdTime,
                    lastPingTime,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                    pendingNotificationEvent: notificationEvent
                        ? null
                        : item.pendingNotificationEvent,
                }),
                createPartTransactionEntry,
            ]);

            if (notificationEvent) {
                context.jobs.send({
                    type: "NotificationEvent",
                    event: notificationEvent,
                });
            }
        } else {
            if (isTimeoutErrorCompletion) {
                throw new InternalError(
                    "Must create a new part when setting `isTimeoutErrorCompletion` to true",
                );
            }

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

            // NOTE(ifitzsimmons): Adding an approval part "completes" the stream, and we can't
            // update a completed stream (we throw earlier in this routine). It should not be
            // possible to reach this line of code. If this assertion fails, it means we never
            // completed the stream when adding the approval part, and we'll need to figure out
            // how/why that happened.
            assert(payload.type !== "ExperimentalApprovals");

            assert(item.lastPartUpdateLockVersion !== null);
            assert(item.lastPartCreatedTime !== null);
            createdTime = item.lastPartCreatedTime;

            const nextPartUpdateLockVersion = item.lastPartUpdateLockVersion + 1;

            const updatePartTransactionEntry = DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments#StreamPart",
                documentId,
                commentThreadId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                updateLockVersion: nextPartUpdateLockVersion,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                DocumentsTable.transactionDirectlyUpdateItem({
                    ...item,
                    lastPingTime,
                    lastPartUpdateLockVersion: nextPartUpdateLockVersion,
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
                        type: "DocumentComment",
                        documentId,
                        commentThreadId,
                        commentIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        broadcastPutDocumentCommentStreamPart(context, {
            documentId,
            commentThreadId,
            commentIndex,
            partIndex,
            version,
            payload,
            createdTime,
            completedTime,
        });

        return {spaceId, createdTime};
    });
}

/**
 * Broadcast an updated comment stream part to all clients connected to the
 * document's collaboration durable object. Called by writers that don't have their
 * own realtime connection to emit events from (e.g. bots writing through the HTTP
 * API).
 */
export function broadcastPutDocumentCommentStreamPart(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        partIndex,
        version,
        payload,
        createdTime,
        completedTime,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        partIndex: number;
        version: number;
        payload: MessageStreamPartPayload;
        createdTime: Date;
        completedTime: Date | null;
    },
) {
    // NOTE(calebmer): If the process dies after committing to DynamoDB but before
    // sending this realtime event the user might not see an update to their message in
    // realtime.
    //
    // Should we send this broadcast event in a DynamoDB Streams listener that reacts
    // to the update? We plan to move `NotificationEvent`, `IndexSearchEntity`, and
    // other processing that needs to reliably run after an updates to DynamoDB
    // Streams.
    context.process.waitUntil(
        context.edge.broadcastToDurableObject(
            `/api/durable-objects/documents/${documentId}/broadcast-put-message-stream-part/${commentThreadId}`,
            {
                serviceName: "DocumentCollaborationService",
                route: "/api/durable-objects/documents/:documentId/broadcast-put-message-stream-part/:commentThreadId",
                body: MessagingRealtimeBroadcastPutMessageStreamPartRequestSchema.serialize({
                    index: commentIndex,
                    partIndex,
                    part: {version, payload, createdTime},
                    completedTime,
                }),
            },
        ),
    );
}

/**
 * We send a notification event for a message stream once the first content stream
 * part is finished. A stream part is considered finished when a new part is
 * created after. Only the last stream part can be updated, all other stream parts
 * are frozen.
 *
 * So practically this means for most streams the notification is sent once we put
 * the second part (`partIndex === 1`) not the first part.
 *
 * Unless this is a timeout error completion, in that case we send the notification
 * immediately since there will be no more parts.
 */
async function getNotificationEventForPutDocumentCommentStreamPart(
    context: DynamoContext,
    {
        spaceId,
        documentId,
        commentThreadId,
        commentIndex,
        item,
        payload,
        partIndex,
        isTimeoutErrorCompletion,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        item: MessageStreamAttributes;
        payload: MessageStreamPartPayload;
        partIndex: number;
        isTimeoutErrorCompletion: boolean;
    },
): Promise<NotificationEvent | null> {
    if (!item.pendingNotificationEvent) return null;

    let content: MessageContent;

    // Always send a notification event for timeout error completions if we haven't
    // sent one already.
    if (isTimeoutErrorCompletion) {
        content = payload.type === "Content" ? payload.content : createSimpleMessageContent();
    } else if (partIndex === 0) {
        return null;
    } else {
        // If we're creating a new part then read the previous part we're finishing. If the
        // previous part is a content part then send a notification using the content from
        // that part.

        const previousPartItem = await DocumentsTable.getItem(
            context,
            {
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments#StreamPart",
                documentId,
                commentThreadId,
                commentIndex,
                partIndex: partIndex - 1,
            },
            // Part's will be added in rapid succession. Make sure we there's no eventual
            // consistency lag.
            {consistency: "Strong"},
        );

        if (previousPartItem.payload.type !== "Content") return null;

        content = previousPartItem.payload.content;
    }

    const contentSnippet = getNotificationMessageContentSnippet(content);

    return {
        type: "CreateDocumentComment",
        id: generateChronologicalId(),
        spaceId,
        documentId,
        commentThreadId,
        commentIndex,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        authorId: item.authorId,
        mentionedAccountIds: getMentionedAccountIdsInContent(content),
        parent: item.pendingNotificationEvent.parent,
        isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
        contentSnippet,
    };
}

/**
 * Completes a comment stream. After this parts can't be added or updated.
 *
 * This function is idempotent. If the stream is already completed this method does
 * nothing.
 */
export function completeDocumentCommentStream(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
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
            authorizeDocumentAccess(context, documentId, "Comment", {consistency}),

            DocumentsTable.getItemIfExists(
                context,
                {
                    partitionType: "DocumentCommentThread",
                    sortRangeType: "Comments#Stream",
                    documentId,
                    commentThreadId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        // Already completed!
        if (item.completedTime !== null) {
            return {spaceId, completedTime: item.completedTime};
        }

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantCompleteStaleMessageStreamError();
        }

        let notificationEvent: NotificationEvent | null = null;

        // If we haven't sent a notification event for this message stream yet then send
        // one now!
        if (item.pendingNotificationEvent) {
            const previousPartItem =
                item.partCount > 0
                    ? await DocumentsTable.getItem(
                          context,
                          {
                              partitionType: "DocumentCommentThread",
                              sortRangeType: "Comments#StreamPart",
                              documentId,
                              commentThreadId,
                              commentIndex,
                              partIndex: item.partCount - 1,
                          },
                          // Part's will be added in rapid succession. Make sure we there's no eventual
                          // consistency lag.
                          {consistency: "Strong"},
                      )
                    : null;

            const content =
                previousPartItem?.payload.type === "Content"
                    ? previousPartItem.payload.content
                    : createSimpleMessageContent();
            const contentSnippet = getNotificationMessageContentSnippet(content);

            notificationEvent = {
                type: "CreateDocumentComment",
                id: generateChronologicalId(),
                spaceId,
                documentId,
                commentThreadId,
                commentIndex,
                createdTime: item.createdTime,
                createdTimeZone: item.createdTimeZone,
                authorId: item.authorId,
                mentionedAccountIds: getMentionedAccountIdsInContent(content),
                parent: item.pendingNotificationEvent.parent,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
            };
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const completedTime = new Date(Date.now());

        await DocumentsTable.directlyUpdateItem(context, {
            ...item,
            completedTime,
            pendingNotificationEvent: notificationEvent ? null : item.pendingNotificationEvent,
        });

        if (notificationEvent) {
            context.jobs.send({
                type: "NotificationEvent",
                event: notificationEvent,
            });
        }

        // NOTE(calebmer): If the process dies after committing to DynamoDB but before
        // sending this realtime event the user might not see an update to their message in
        // realtime.
        //
        // Should we send this broadcast event in a DynamoDB Streams listener that reacts
        // to the update? We plan to move `NotificationEvent`, `IndexSearchEntity`, and
        // other processing that needs to reliably run after an updates to DynamoDB
        // Streams.
        context.process.waitUntil(
            context.edge.broadcastToDurableObject(
                `/api/durable-objects/documents/${documentId}/broadcast-complete-message-stream/${commentThreadId}`,
                {
                    serviceName: "DocumentCollaborationService",
                    route: "/api/durable-objects/documents/:documentId/broadcast-complete-message-stream/:commentThreadId",
                    body: MessagingRealtimeBroadcastCompleteMessageStreamRequestSchema.serialize({
                        index: commentIndex,
                        completedTime,
                    }),
                },
            ),
        );

        return {spaceId, completedTime};
    });
}

/**
 * Pings a comment stream and updates its `lastPingTime`.
 *
 * This function is idempotent. If the stream hasn't been pinged in a while this
 * method will update its `lastPingTime`.
 */
export function pingDocumentCommentStream(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    lastPingTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizeDocumentAccess(context, documentId, "Comment", {consistency}),

            DocumentsTable.getItemIfExists(
                context,
                {
                    partitionType: "DocumentCommentThread",
                    sortRangeType: "Comments#Stream",
                    documentId,
                    commentThreadId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn\u2019t a stream", {
                displayMessage: errorDisplayMessage`Message isn\u2019t a stream.`,
            });
        }

        await authorizeOwnSpaceAccountAccess(context, item.authorId, {
            displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
        });

        if (item.completedTime !== null) {
            throw createCantPingCompletedMessageStreamError();
        }

        if (hasMessageStreamDefinitelyTimedOut(item)) {
            throw createCantPingStaleMessageStreamError();
        }

        // NOTE(calebmer): Using `Date.now()` allows our Jest tests to mock `Date.now()`
        // and override the time that is returned.
        const currentTime = new Date(Date.now());

        const lastPingTime =
            item.lastPingTime && currentTime <= item.lastPingTime
                ? // NOTE(ifitzsimmons): This makes sure lastPingTime is always at least 1ms ahead of
                  // the previous ping time. This is important if we have two different instances
                  // processing pings with different clock skews.
                  new Date(item.lastPingTime.getTime() + 1)
                : currentTime;

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        // Our `IndexSearchEntity` job also serves to expire streams that haven't been
        // updated in a while. So we need to re-schedule it when the stream is pinged.
        if (
            shouldScheduleMessageStreamIndexSearchEntityJob(
                item.lastIndexSearchEntityJob,
                lastPingTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        await DocumentsTable.directlyUpdateItem(context, {
            ...item,
            lastPingTime,
            lastIndexSearchEntityJob: nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
        });

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "DocumentComment",
                        documentId,
                        commentThreadId,
                        commentIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        return {spaceId, lastPingTime};
    });
}

/**
 * Get a single document comment.
 */
export async function getDocumentComment(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<DocumentCommentModel> {
    const {spaceId, commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
    });

    return await createDocumentCommentModelFromItem(
        context,
        spaceId,
        documentId,
        commentThreadId,
        commentItem,
    );
}

/**
 * Get a document comment with a version that's either equal to or greater than the
 * provided version.
 */
export async function getDocumentCommentAtVersion(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        version,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        version: number;
    },
): Promise<DocumentCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment"),

        (async () => {
            let item = await getDocumentCommentItemIfExistsWithoutAuthorization(
                context,
                documentId,
                commentThreadId,
                commentIndex,
                {consistency: "Eventual"},
            );

            if (!item || item.version < version) {
                item = await getDocumentCommentItemIfExistsWithoutAuthorization(
                    context,
                    documentId,
                    commentThreadId,
                    commentIndex,
                    {consistency: "Strong"},
                );
            }

            if (!item) {
                throw createDocumentCommentNotFoundError(documentId, commentThreadId, commentIndex);
            }

            if (item.version < version) {
                throw new FailedPreconditionError("Can\u2019t get message at a future version");
            }

            return item;
        })(),
    ]);

    return await createDocumentCommentModelFromItem(
        context,
        spaceId,
        documentId,
        commentThreadId,
        item,
    );
}

/**
 * Get a single document comment's payload.
 */
export async function getDocumentCommentPayload(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<MessageItem & {spaceId: SpaceId}> {
    const {spaceId, commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
        consistency,
    });

    return {
        spaceId,
        ...commentItem,
    };
}

export async function getDocumentCommentMessageApprovals(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    approvals: ReadonlyArray<MessageExperimentalApproval>;
}> {
    // NOTE(ifitzsimmons, 2026-07-06): We decided to fetch the entire message item (a
    // single query) because the entire message (including all parts) will almost
    // always fit within 4kb and will thus cost 0.5 RCUs (from an Eventually Consistent
    // read). There are times when the message content will exceed 4kb, but this will
    // still almost always be more efficient than
    //
    // 1. getItem(Comments#Stream) - 0.5 RCU
    // 2. query(Comments#StreamPart, limit=1, descending=true) - 0.5 RCU
    //
    // ... which makes 2 roundtrips to DynamoDB.
    const {spaceId, commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
        consistency,
    });

    if (!commentItem.stream) throw createMessageApprovalRequiresMessageStreamError();

    const lastStreamPart = assertExists(
        commentItem.stream.parts[commentItem.stream.parts.length - 1],
    );

    if (lastStreamPart.payload.type !== "ExperimentalApprovals") {
        throw createMessageApprovalNotFoundError();
    }

    return {
        spaceId,
        approvals: lastStreamPart.payload.approvals,
    };
}

export async function putDocumentCommentMessageApprovalDecisions(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        payload,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        payload: PutMessageApprovalDecisionsPayload;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    approvals: ReadonlyArray<MessageExperimentalApproval>;
    partIndex: number;
    version: number;
    createdTime: Date;
    completedTime: Date | null;
}> {
    return await putMessageApprovalDecisions(context, {
        room: {type: "DocumentCommentThread", id: documentId, threadId: commentThreadId},
        messageIndex: commentIndex,
        payload,
        consistency,
        readApprovalStreamPart: async context => {
            // NOTE(ifitzsimmons, 2026-07-06): We decided to fetch the entire message item (a
            // single query) because the entire message (including all parts) will almost
            // always fit within 4kb and will thus cost 0.5 RCUs (from an Eventually Consistent
            // read). There are times when the message content will exceed 4kb, but this will
            // still almost always be more efficient than
            //
            // 1. getItem(Comments#Stream) - 0.5 RCU
            // 2. query(Comments#StreamPart, limit=1, descending=true) - 0.5 RCU
            //
            // ... which makes 2 roundtrips to DynamoDB.
            const comment = await getDocumentCommentItem(context, {
                documentId,
                commentThreadId,
                commentIndex,
                consistency,
            });

            return {
                spaceId: comment.spaceId,
                message: comment.commentItem,
                putMessageApprovalPartPayloadWithDecisionValues: async ({
                    partIndex,
                    createdTime,
                    version,
                    nextPayload,
                }: {
                    partIndex: number;
                    createdTime: Date;
                    version: number;
                    nextPayload: MessageStreamExperimentalApprovalsPartPayload;
                }) => {
                    const updatedPart = await DocumentsTable.directlyUpdateItem(context, {
                        partitionType: "DocumentCommentThread",
                        sortRangeType: "Comments#StreamPart",
                        documentId,
                        commentThreadId,
                        commentIndex,
                        partIndex,
                        payload: nextPayload,
                        createdTime,
                        updateLockVersion: version,
                    });

                    return {version: updatedPart.updateLockVersion};
                },
            };
        },
    });
}

/**
 * Get a document comment's author.
 */
export async function getDocumentCommentAuthorId(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<AccountId> {
    const {commentItem} = await getDocumentCommentItem(context, {
        documentId,
        commentThreadId,
        commentIndex,
    });

    return commentItem.authorId;
}

const DocumentCommentItemContextCache = new DynamoContextCache<
    `${DocumentId}-${DocumentCommentThreadId}:${number}`,
    MessageItem | null
>({
    // Allow sharing this cache because the results do not depend on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getDocumentCommentItemIfExistsWithoutAuthorization(
    context: ServerActionContext,
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: DocumentCommentItemContextCache,
            cacheKeyPrefix: `${documentId}-${commentThreadId}`,
            consistency,
            startIndex: commentIndex,
            endIndex: commentIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                DocumentsTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {
                        partitionType: "DocumentCommentThread",
                        documentId,
                        commentThreadId,
                    },
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    assert(items.length <= 1);

    return items[0] ?? null;
}

async function getDocumentCommentItem(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
) {
    const [{spaceId}, commentThreadItem, commentItem] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment", {consistency}),

        // Throws an error if the comment thread item doesn't exist.
        getDocumentCommentThreadItemIfExists(context, {
            documentId,
            commentThreadId,
            consistency,
        }),

        getDocumentCommentItemIfExistsWithoutAuthorization(
            context,
            documentId,
            commentThreadId,
            commentIndex,
            {consistency},
        ),
    ]);

    if (!commentThreadItem)
        throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

    if (!commentItem)
        throw createDocumentCommentNotFoundError(documentId, commentThreadId, commentIndex);

    return {
        spaceId,
        commentItem,
    };
}

async function createDocumentCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
    item: MessageItem,
): Promise<DocumentCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FileDocumentAuthorizer.bind({type: "DocumentComments", documentId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new DocumentCommentModel({
        documentId,
        commentThreadId,
        index: item.index,
        version: item.version,
        author,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
        payload,
        stream: item.stream,
    });
}

/**
 * Update the content on one of your document comments.
 */
export function updateDocumentCommentContent(
    context: ServerAccountActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        contentVersion,
        steps,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: MessageContent;
    contentUpdate: MessageContentPayloadContentUpdate;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, commentThreadItem, commentItem] = await runAllPromises([
            authorizeDocumentAccess(context, documentId, "Comment"),

            getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            }),
            DocumentsTable.getItem(context, {
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments",
                documentId,
                commentThreadId,
                commentIndex,
            }),
        ]);

        if (commentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only update comments you authored");

        const {oldPayload, newPayload} = computeUpdateMessageContent(
            commentItem,
            contentVersion,
            steps,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentThreadItem.commentsSummary.mentionCountByAccountId,
            oldPayload.content,
            newPayload.content,
        );

        const transactionEntry = DocumentsTable.transactionDirectlyUpdateItem({
            ...commentItem,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            DocumentsTable.transactionDirectlyUpdateItemAttribute(
                commentThreadItem,
                "commentsSummary",
                {
                    nextCommentIndex: commentThreadItem.commentsSummary.nextCommentIndex,
                    commentCountByAuthorId:
                        commentThreadItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: commentThreadItem.updateLockVersion},
            ),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "MessageUpdates",
                documentId,
                commentThreadId,
                eventTime: newPayload.contentUpdate.time,
                messageIndex: commentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(
                    newPayload.contentUpdate.time,
                    messagingEventExpirationDays,
                ),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "DocumentComment",
                documentId,
                commentThreadId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            spaceId,
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            content: newPayload.content,
            contentUpdate: newPayload.contentUpdate,
        };
    });
}

/**
 * Delete a single document comment.
 */
export function deleteDocumentComment(
    context: ServerAccountActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
    },
): Promise<{version: number; deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, commentThreadItem, commentItem] = await runAllPromises([
            authorizeDocumentAccess(context, documentId, "Comment"),
            getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            }),
            DocumentsTable.getItem(context, {
                partitionType: "DocumentCommentThread",
                sortRangeType: "Comments",
                documentId,
                commentThreadId,
                commentIndex,
            }),
        ]);

        if (commentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError(
                "Can\u2019t delete comments with a non-content payload",
            );

        if (commentItem.payload.clerical)
            throw new FailedPreconditionError("Can\u2019t delete clerical comments");

        const deletedTime = new Date();

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            commentThreadItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            null,
        );

        const transactionEntry = DocumentsTable.transactionDirectlyUpdateItem({
            ...commentItem,
            payload: {type: "Deleted", deletedTime},
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            DocumentsTable.transactionDirectlyUpdateItemAttribute(
                commentThreadItem,
                "commentsSummary",
                {
                    nextCommentIndex: commentThreadItem.commentsSummary.nextCommentIndex,
                    commentCountByAuthorId:
                        commentThreadItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: commentThreadItem.updateLockVersion},
            ),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "MessageUpdates",
                documentId,
                commentThreadId,
                eventTime: deletedTime,
                messageIndex: commentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(deletedTime, messagingEventExpirationDays),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "DocumentComment",
                documentId,
                commentThreadId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            deletedTime,
        };
    });
}

export function setDocumentCommentReaction(
    context: ServerSessionActionContextWithPush,
    {
        documentId,
        commentThreadId,
        commentIndex,
        contentVersion,
        pos,
        reaction,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
        reaction: Reaction | "GenericLike";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, commentThreadItem, commentItem] = await runAllPromises([
            authorizeDocumentAccess(context, documentId, "Comment"),
            getDocumentCommentThreadItem(context, {
                documentId,
                commentThreadId,
            }),
            getDocumentCommentItemIfExistsWithoutAuthorization(
                context,
                documentId,
                commentThreadId,
                commentIndex,
            ),
        ]);
        if (!commentItem) throw new NotFoundError("Document comment not found");

        const currentTime = new Date();

        const newPayload = computeSetMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
            reaction,
        });

        const transactionEntry = DocumentsTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "DocumentCommentThread",
            sortRangeType: "Comments",
            documentId,
            commentThreadId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "MessageUpdates",
                documentId,
                commentThreadId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        context.process.waitUntil(
            context.notificationsInjection.archiveDocumentCommentThreadEntryAfterSetDocumentCommentReaction(
                {
                    spaceId,
                    documentId,
                    commentThreadId,
                    commentCount: getDocumentCommentCount(commentThreadItem.commentsSummary),
                    commentIndex,
                },
            ),
        );

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

export function deleteDocumentCommentReaction(
    context: ServerAccountActionContext,
    {
        documentId,
        commentThreadId,
        commentIndex,
        contentVersion,
        pos,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        commentIndex: number;
        contentVersion: number;
        pos: number | "Files";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [, commentItem] = await runAllPromises([
            authorizeDocumentAccess(context, documentId, "Comment"),
            getDocumentCommentItemIfExistsWithoutAuthorization(
                context,
                documentId,
                commentThreadId,
                commentIndex,
            ),
        ]);
        if (!commentItem) throw new NotFoundError("Document comment not found");

        const currentTime = new Date();

        const newPayload = computeDeleteMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
        });

        const transactionEntry = DocumentsTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "DocumentCommentThread",
            sortRangeType: "Comments",
            documentId,
            commentThreadId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version` are
            // all in the item key. So we won't be replacing any existing update item.
            DocumentsTable.transactionCreateOrReplaceItem({
                partitionType: "DocumentCommentThread",
                sortRangeType: "MessageUpdates",
                documentId,
                commentThreadId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

/**
 * Get a document comment thread and some initial comments for that thread.
 */
export async function getDocumentCommentThreadAndInitialCommentsIfExists(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
    },
): Promise<{
    commentThread: DocumentCommentThreadModel | null;
    initialComments: Array<DocumentCommentModel>;
    initialOtherReferencedComments: Array<DocumentCommentModel>;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId, "Comment");

    const [, commentThread, {comments, otherReferencedComments}] = await runAllPromises([
        documentAuthorizationPromise,
        (async () => {
            const commentThreadItem = await getDocumentCommentThreadItemIfExists(context, {
                documentId,
                commentThreadId,
            });
            if (!commentThreadItem) return null;

            const {spaceId} = await documentAuthorizationPromise;
            return await createDocumentCommentThreadModelFromItem(
                context,
                spaceId,
                commentThreadItem,
            );
        })(),
        getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        }),
    ]);

    if (!commentThread) {
        return {
            commentThread: null,
            // Return empty comment arrays even if we got `comments` and
            // `otherReferencedComments` since we haven't authorized the user has access.
            initialComments: [],
            initialOtherReferencedComments: [],
        };
    }

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentThread: commentThread.clone({
            commentCount: Math.max(
                commentThread.commentCount,
                // Make sure `commentCount` is consistent with `comments` in case of eventual
                // consistency race conditions.
                lastCommentIndex + 1,
            ),
        }),
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
    };
}

/**
 * Get a document comment thread and some initial comments for that thread.
 */
export async function getDocumentCommentThreadAndInitialComments(
    context: ServerActionContext,
    input: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
    },
): Promise<{
    commentThread: DocumentCommentThreadModel;
    initialComments: Array<DocumentCommentModel>;
    initialOtherReferencedComments: Array<DocumentCommentModel>;
}> {
    const {commentThread, initialComments, initialOtherReferencedComments} =
        await getDocumentCommentThreadAndInitialCommentsIfExists(context, input);

    if (!commentThread) throw new NotFoundError("Couldn\u2019t find document comment thread");

    return {commentThread, initialComments, initialOtherReferencedComments};
}

/**
 * Get a document, some comment threads in the document, and initial comments for
 * these threads as if we are rendering the list of comment threads in order.
 *
 * For instance, if we have a limit of 20 and the first comment thread has 15
 * comments and the second comment thread has 30 comments then we'd load 15
 * comments from the first thread and 5 comments from the second thread to meet our
 * 20 comment limit. We may load more comments than our limit since we load some
 * comment threads in parallel before we know how many comments they contain.
 */
export async function getDocumentAndCommentThreadsWithInitialComments(
    context: ServerActionContext,
    {
        documentId,
        commentThreadIds,
        commentLimit,
        commentThreadCountAgainstLimit,
        onSpaceId,
    }: {
        documentId: DocumentId;
        commentThreadIds:
            | Iterable<DocumentCommentThreadId>
            | Promise<Iterable<DocumentCommentThreadId>>;
        commentLimit: number;
        // Comment threads take some space in our rendered list of comment threads. This
        // number specifies how much we should decrease our limit for every comment thread
        // we load.
        //
        // For example, if this is set to 5 then we decrease the limit by 5 for every
        // comment thread between comments. So if we have a comment thread with 10 comments
        // and a comment thread of 20 comments and we run this function with a limit of 12
        // then we only load comments from the first thread because the thread itself
        // counts for 5 comments.
        //
        // This number can be fractional like 5.8.
        commentThreadCountAgainstLimit: number;
        // If you pass this in, we will call once we've loaded the `SpaceId` for the
        // document which may be before the function as a whole returns. This function will
        // not be called in error cases.
        onSpaceId?: (spaceId: SpaceId) => void;
    },
): Promise<{
    document: DocumentModel;
    commentThreads: ReadonlyArray<DocumentCommentThreadModel>;
    initialCommentsByCommentThreadId: Map<
        DocumentCommentThreadId,
        {
            comments: Array<DocumentCommentModel>;
            otherReferencedComments: Array<DocumentCommentModel>;
        }
    >;
}> {
    const spaceIdPromiseResolver = createPromiseResolver<SpaceId>();

    const documentPromise = getDocumentWithOptionalCommentsAndCommentThreads(context, {
        documentId,
        // Setting this to something other than undefined forces us to throw an error if we
        // don't have comment access to the document. Instead of returning the document
        // without comment marks.
        commentThreadIds,
        onSpaceId: spaceId => {
            spaceIdPromiseResolver.resolve(spaceId);
            onSpaceId?.(spaceId);
        },
    }).then(
        result => {
            spaceIdPromiseResolver.resolve(result.document.spaceId);
            return result;
        },
        error => {
            spaceIdPromiseResolver.reject(error);
            throw error;
        },
    );

    const initialCommentsByCommentThreadIdPromise = (async () => {
        const commentThreadIdQueue = Array.from(await commentThreadIds);
        let currentCommentLimit = commentLimit;

        const initialCommentsByCommentThreadId = new Map<
            DocumentCommentThreadId,
            {
                comments: Array<DocumentCommentModel>;
                otherReferencedComments: Array<DocumentCommentModel>;
            }
        >();

        while (currentCommentLimit > 0 && commentThreadIdQueue.length > 0) {
            const commentThread1Id = commentThreadIdQueue.shift()!;
            const commentThread2Id = commentThreadIdQueue.shift();

            const [commentThread1Result, commentThread2Result] = await runAllPromises([
                getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
                    documentId,
                    commentThreadId: commentThread1Id,
                    getSpaceId: () => spaceIdPromiseResolver.promise,
                    limit: Math.ceil(currentCommentLimit),
                    afterCommentIndex: null,
                    beforeCommentIndex: null,
                }),
                commentThread2Id
                    ? getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
                          documentId,
                          commentThreadId: commentThread2Id,
                          getSpaceId: () => spaceIdPromiseResolver.promise,
                          limit: Math.ceil(currentCommentLimit),
                          afterCommentIndex: null,
                          beforeCommentIndex: null,
                      })
                    : null,
            ]);

            currentCommentLimit -= commentThreadCountAgainstLimit;
            currentCommentLimit -= commentThread1Result.comments.length;
            initialCommentsByCommentThreadId.set(commentThread1Id, commentThread1Result);

            if (commentThread2Result) {
                currentCommentLimit -= commentThreadCountAgainstLimit;
                currentCommentLimit -= commentThread2Result.comments.length;
                initialCommentsByCommentThreadId.set(commentThread2Id!, commentThread2Result);
            }
        }

        return initialCommentsByCommentThreadId;
    })();

    const [{document, commentThreads}, initialCommentsByCommentThreadId] = await runAllPromises([
        documentPromise,
        initialCommentsByCommentThreadIdPromise,
    ]);

    return {
        document,
        commentThreads,
        initialCommentsByCommentThreadId,
    };
}

function getDocumentCommentCount(
    commentSummary: {readonly commentCountByAuthorId: ReadonlyMap<AccountId, number>} | undefined,
) {
    if (!commentSummary) return 0;
    return sumIterable(commentSummary.commentCountByAuthorId.values());
}

/**
 * Paginate through document comments from start to finish.
 */
export async function getDocumentCommentsFromStart(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId, "Comment");

    const [, commentThreadItem, {comments, otherReferencedComments}] = await runAllPromises([
        documentAuthorizationPromise,
        getDocumentCommentThreadItemIfExists(context, {
            documentId,
            commentThreadId,
        }),
        getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    if (!commentThreadItem)
        throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getDocumentCommentCount(commentThreadItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
    };
}

async function getDocumentCommentsFromStartAssumingAuthorizedCommentThread(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoReadConsistency;
    },
): Promise<{
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const commentItems = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: DocumentCommentItemContextCache,
            cacheKeyPrefix: `${documentId}-${commentThreadId}`,
            consistency,
            startIndex: queryStartCommentIndex,
            endIndex: queryEndCommentIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                DocumentsTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {
                        partitionType: "DocumentCommentThread",
                        documentId,
                        commentThreadId,
                    },
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<DocumentCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getDocumentCommentItemIfExistsWithoutAuthorization(
                    context,
                    documentId,
                    commentThreadId,
                    commentIndex,
                    {consistency},
                );
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
                }

                otherReferencedComments.push(
                    await createDocumentCommentModelFromItem(
                        context,
                        spaceId,
                        documentId,
                        commentThreadId,
                        item,
                    ),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
            }

            // Don't propagate `consistency` when loading model references. We accept
            // references can have eventual consistency.
            return createDocumentCommentModelFromItem(
                context,
                spaceId,
                documentId,
                commentThreadId,
                item,
            );
        }),
    );

    // Keep loading other referenced comments until we have all of them. A referenced
    // comment may itself reference more comments.
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

/**
 * Paginate through document comments from start to finish.
 */
export async function getDocumentCommentPayloadsFromStart(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
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

    const [{spaceId}, commentThreadItem, comments] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment", {consistency}),
        getDocumentCommentThreadItemIfExists(context, {
            documentId,
            commentThreadId,
            consistency,
        }),
        arrayFromAsyncIterable(
            runCommentsQuery(context, {
                cache: DocumentCommentItemContextCache,
                cacheKeyPrefix: `${documentId}-${commentThreadId}`,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    DocumentsTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {
                            partitionType: "DocumentCommentThread",
                            documentId,
                            commentThreadId,
                        },
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    if (!commentThreadItem)
        throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        spaceId,
        commentCount: Math.max(
            getDocumentCommentCount(commentThreadItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
    };
}

/**
 * Paginate through document comments from finish to start.
 */
export async function getDocumentCommentsFromEnd(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
}> {
    const authorizationPromise = authorizeDocumentAccess(context, documentId, "Comment");

    const commentThreadItemPromise = getDocumentCommentThreadItemIfExists(context, {
        documentId,
        commentThreadId,
    });

    const [, commentThreadItem, {comments, otherReferencedComments}] = await runAllPromises([
        authorizationPromise,
        commentThreadItemPromise,
        getDocumentCommentsFromEndAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            authorizationPromise,
            commentThreadItemPromise,
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    if (!commentThreadItem)
        throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getDocumentCommentCount(commentThreadItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
        otherReferencedComments,
    };
}

async function getDocumentCommentsFromEndAssumingAuthorizedCommentThread(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        authorizationPromise,
        commentThreadItemPromise,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        authorizationPromise: Promise<{spaceId: SpaceId}>;
        commentThreadItemPromise: Promise<DocumentCommentThreadItem | null>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<DocumentCommentModel>;
    otherReferencedComments: Array<DocumentCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if
              // there was a message stream then query again with `limit: "All"` and a proper
              // query start index. Instead right now we wait for chat access to authorize before
              // starting our query which is slower than authorizing + querying in parallel.
              getDocumentCommentCount((await commentThreadItemPromise)?.commentsSummary) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const commentItems = await arrayFromAsyncIterable(
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? runCommentsQuery(context, {
                  cache: DocumentCommentItemContextCache,
                  cacheKeyPrefix: `${documentId}-${commentThreadId}`,
                  consistency: undefined,
                  startIndex: queryStartCommentIndex,
                  endIndex: queryEndCommentIndex,
                  query: ({consistency, limit, startSortKey, endSortKey}) =>
                      DocumentsTable.query(context, {
                          consistency,
                          limit,
                          partitionKey: {
                              partitionType: "DocumentCommentThread",
                              documentId,
                              commentThreadId,
                          },
                          startSortKey,
                          endSortKey,
                      }),
              })
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const {spaceId} = await authorizationPromise;

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<DocumentCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need to
        // load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getDocumentCommentItemIfExistsWithoutAuthorization(
                    context,
                    documentId,
                    commentThreadId,
                    commentIndex,
                );
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
                }

                otherReferencedComments.push(
                    await createDocumentCommentModelFromItem(
                        context,
                        spaceId,
                        documentId,
                        commentThreadId,
                        item,
                    ),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
            }
            return createDocumentCommentModelFromItem(
                context,
                spaceId,
                documentId,
                commentThreadId,
                item,
            );
        }),
    );

    // Keep loading other referenced comments until we have all of them. A referenced
    // comment may itself reference more comments.
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

/**
 * Paginate through document comments from finish to start.
 */
export async function getDocumentCommentPayloadsFromEnd(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
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
    const commentThreadItemPromise = getDocumentCommentThreadItemIfExists(context, {
        documentId,
        commentThreadId,
        consistency,
    });

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if
              // there was a message stream then query again with `limit: "All"` and a proper
              // query start index. Instead right now we wait for chat access to authorize before
              // starting our query which is slower than authorizing + querying in parallel.
              getDocumentCommentCount((await commentThreadItemPromise)?.commentsSummary) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const [{spaceId}, commentThreadItem, comments] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment", {consistency}),
        commentThreadItemPromise,
        arrayFromAsyncIterable(
            runCommentsQuery(context, {
                cache: DocumentCommentItemContextCache,
                cacheKeyPrefix: `${documentId}-${commentThreadId}`,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    DocumentsTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {
                            partitionType: "DocumentCommentThread",
                            documentId,
                            commentThreadId,
                        },
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

    if (!commentThreadItem)
        throw createDocumentCommentThreadNotFoundError(documentId, commentThreadId);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        spaceId,
        commentCount: Math.max(
            getDocumentCommentCount(commentThreadItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
    };
}

/**
 * Backfills any missing comments or comment updates for a client. The client
 * provides what it knows to be the comment count and last change time then we
 * return any new comments or changes since then.
 *
 * We run this when the client establishes a new realtime connection to catch the
 * client up between their last data load and the time the realtime connection was
 * established.
 *
 * `newCommentLimit` allows you to load some new comments that the client may be
 * missing but only up to the limit.
 *
 * We do not keep a log of document comment changes around forever, so it's
 * possible that you get an `Unavailable` result for `commentChangesResult`. When
 * this happens you should throw away all data your client has loaded and try
 * loading the data again.
 */
export async function backfillDocumentComments(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        checkpoint,
        clientCommentCount,
        newCommentLimit,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        checkpoint: ServerSynchronizationCheckpoint;
        clientCommentCount: number;
        newCommentLimit: number;
    },
): Promise<{
    // We also backfill the full comment thread object in case it changed. Other
    // messaging backfill implementations don't do this. It's important here because we
    // need to know whether the comment thread is resolved and the latest fallback
    // content snippet.
    commentThread: DocumentCommentThreadModel;

    commentCount: number;
    newComments: Array<DocumentCommentModel>;
    newOtherReferencedComments: Array<DocumentCommentModel>;
    commentUpdatesResult: MessageUpdatesBackfillResult<DocumentCommentModel>;
}> {
    const documentAuthorizationPromise = authorizeDocumentAccess(context, documentId, "Comment");

    const commentThreadItemPromise = getDocumentCommentThreadItem(context, {
        documentId,
        commentThreadId,
        // We're also backfilling the comment thread object. So we need to read it with
        // strong consistency.
        consistency: "Strong",
    });

    const [
        {commentThreadItem, commentThread},
        {comments, otherReferencedComments},
        commentUpdatesResult,
    ] = await runAllPromises([
        runAllPromises([documentAuthorizationPromise, commentThreadItemPromise]).then(
            async ([documentPreview, commentThreadItem]) => ({
                commentThreadItem,
                commentThread: await createDocumentCommentThreadModelFromItem(
                    context,
                    documentPreview.spaceId,
                    commentThreadItem,
                ),
            }),
        ),
        getDocumentCommentsFromStartAssumingAuthorizedCommentThread(context, {
            documentId,
            commentThreadId,
            getSpaceId: () => documentAuthorizationPromise.then(({spaceId}) => spaceId),
            limit: newCommentLimit,
            afterCommentIndex: clientCommentCount - 1,
            beforeCommentIndex: null,
            // Use a strong read consistency when backfilling. This guarantees the caller will
            // observe all realtime events before this function call. Realtime events that
            // happen during the function call may be missed. You should be subscribed to new
            // realtime events before starting to backfill.
            consistency: "Strong",
        }),
        runBackfillMessageUpdates(context, {
            checkpoint,
            queryMessageUpdates: (context, options) =>
                DocumentsTable.query(context, {
                    partitionKey: {
                        partitionType: "DocumentCommentThread",
                        documentId,
                        commentThreadId,
                    },
                    ...options,
                }),
            getMessageIfExists: (context, messageIndex, options) =>
                getDocumentCommentItemIfExistsWithoutAuthorization(
                    context,
                    documentId,
                    commentThreadId,
                    messageIndex,
                    options,
                ),
            createMessageModelFromItem: async (context, item) => {
                const {spaceId} = await documentAuthorizationPromise;
                return await createDocumentCommentModelFromItem(
                    context,
                    spaceId,
                    documentId,
                    commentThreadId,
                    item,
                );
            },
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentThread,
        commentCount: Math.max(
            getDocumentCommentCount(commentThreadItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentUpdatesResult,
    };
}

/**
 * Get accounts subscribed to notifications for the provided document comment
 * thread. For the first comment in a comment thread, the document owner is also
 * considered a subscriber.
 */
export async function getDocumentCommentThreadNotificationSubscribers(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
        isFirstComment,
        consistency = "Eventual",
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
        isFirstComment: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    accountIds: Set<AccountId>;
}> {
    const [{creatorId}, commentThreadItem] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment", {consistency}),
        getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
            consistency,
        }),
    ]);

    const accountIds = new Set(
        concatIterables(
            isFirstComment && creatorId ? [creatorId] : [],
            commentThreadItem.commentsSummary.commentCountByAuthorId.keys(),
            commentThreadItem.commentsSummary.mentionCountByAccountId.keys(),
        ),
    );

    return {accountIds};
}

/**
 * For a resolved comment thread, get the ranges of text the comment was
 * highlighting so we can add the comment back to the document.
 *
 * This function is partially strongly consistent. If a comment thread was recently
 * marked as resolved you'll get the ranges back with strong consistency. If a
 * comment thread was recently marked as unresolved this function may still report
 * it as resolved.
 */
export async function getResolvedDocumentCommentThreadRanges(
    context: ServerActionContext,
    {
        documentId,
        commentThreadId,
    }: {
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
    },
): Promise<{
    version: number;
    ranges: ReadonlyArray<AddMarksAfterRemoveAllStepRange>;
}> {
    let [, commentThreadItem] = await runAllPromises([
        authorizeDocumentAccess(context, documentId, "Comment"),
        getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
            // Since this is a resolved comment thread, we should try reading from the archive
            // since the comment shouldn't be referenced in the document.
            shouldTryArchiveFirst: true,
        }),
    ]);

    // This function pre-supposes the comment thread is resolved. So if we don't read a
    // resolved comment thread that may be because we read with eventual consistency.
    // Try again with strong consistency before throwing an error.
    if (commentThreadItem.resolutionState.type !== "Resolved") {
        commentThreadItem = await getDocumentCommentThreadItem(context, {
            documentId,
            commentThreadId,
            consistency: "Strong",
            shouldTryArchiveFirst: true,
        });
    }

    if (commentThreadItem.resolutionState.type !== "Resolved") {
        throw new FailedPreconditionError("Document comment thread is not resolved");
    }

    return {
        version: commentThreadItem.resolutionState.version,
        ranges: commentThreadItem.resolutionState.ranges,
    };
}

export async function getDocumentCommentParentContent(
    context: ServerActionContext,
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
    {
        parent,
        consistency,
    }: {parent: MessageContentPayloadParent; consistency?: DynamoCacheReadConsistency},
): Promise<{content: MessageContent; authorId: AccountId}> {
    await authorizeDocumentAccess(context, documentId, "View", {consistency});

    const messageNoun = "comment";

    switch (parent.type) {
        case "Message": {
            const {commentItem} = await getDocumentCommentItem(context, {
                documentId,
                commentThreadId,
                commentIndex: parent.index,
                consistency,
            });

            return {
                authorId: commentItem.authorId,
                content:
                    commentItem.payload.type === "Content"
                        ? cutMessageContentPayload({
                              payload: commentItem.payload,
                              stream: commentItem.stream,
                          })
                        : createSimpleMessageContent(`Deleted ${messageNoun}`),
            };
        }
        case "MessagesRange": {
            const messageItems = await arrayFromAsyncIterable(
                runCommentsQuery(context, {
                    cache: DocumentCommentItemContextCache,
                    cacheKeyPrefix: `${documentId}-${commentThreadId}`,
                    consistency,
                    startIndex: parent.startIndex,
                    endIndex: parent.endIndex,
                    query: ({consistency, limit, startSortKey, endSortKey}) =>
                        DocumentsTable.query(context, {
                            consistency,
                            limit,
                            partitionKey: {
                                partitionType: "DocumentCommentThread",
                                documentId,
                                commentThreadId,
                            },
                            startSortKey,
                            endSortKey,
                        }),
                }),
            );

            validateMessageContentPayloadMessagesRangeParent(parent, messageItems, {
                allowDeletedMessagesForStartAndEndMessages: true,
            });

            return {
                // `validateMessageContentPayloadMessagesRangeParent()` guarantees that all
                // messages have the same author and the list is not empty.
                authorId: messageItems[0]!.authorId,
                content: getTruncatedParentMessagesRangeContentWithoutReferences({
                    messages: messageItems,
                    messageNoun,
                    startContentVersion: parent.startContentVersion,
                    startPos: parent.startPos,
                    endContentVersion: parent.endContentVersion,
                    endPos: parent.endPos,
                }),
            };
        }
        case "PostRange": {
            throw new InvalidArgumentError("Post range parent can only be used with post comments");
        }
        default:
            throw exhaustive(parent);
    }
}

/**
 * We need a special function for creating documents that were created by bots. A
 * document created by a non-bot always gives manage access to the human that
 * created the document. Bots are different. If we gave access only to account that
 * created the document (the bot) no other users would be able to read the
 * document.
 */
async function createEmptyDocumentContentForBot(
    context: ServerMinimalBotActionContext,
    spaceId: SpaceId,
) {
    const accessPolicy = await createAccessPolicyForContentCreatedByBot(context, spaceId, {
        consistency: "StrongWithinCache",
    });

    return assertDocumentContent(
        DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [
            DocumentContentProsemirrorSchema.node("title"),
            DocumentContentProsemirrorSchema.node("paragraph"),
        ]),
    );
}

function validateEntityCreationInSiteIfNeeded(
    initialAccessPolicyIfExists: AccessPolicy | undefined,
    sitePosition: {siteId: SiteId; parentId: SiteContainerId; orderKey: OrderKey} | undefined,
) {
    if (sitePosition) {
        // If site position is provided without an initial access policy, we'll create a
        // site access policy for the document using the `siteId` from `sitePosition`
        if (!initialAccessPolicyIfExists) {
            return;
        } else {
            if (
                initialAccessPolicyIfExists.type === "Site" &&
                initialAccessPolicyIfExists.siteId !== sitePosition.siteId
            ) {
                throw new InvalidArgumentError(
                    "Can\u2019t create a document in a site with a different site ID",
                );
            }

            if (initialAccessPolicyIfExists.type !== "Site") {
                throw new InvalidArgumentError(
                    "Can\u2019t create a document with a non-site access policy in a site",
                );
            }
        }
    }
    // Site position was not provided
    else {
        // If neither the sitePosition or initialAccessPolicyIfExists are provided, we'll
        // create a default local access policy for the document.
        if (!initialAccessPolicyIfExists) {
            return;
        }
        // If the initial access policy is a site and the client didn't provide the site
        // position, throw an error.
        else if (initialAccessPolicyIfExists.type === "Site") {
            throw new InvalidArgumentError(
                "Can\u2019t create a document in a site without specifying the site position",
            );
        }
    }
}
