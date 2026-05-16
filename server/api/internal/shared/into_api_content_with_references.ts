import {Node} from "prosemirror-model";
import {getContentFileReference} from "~/server/content/get_content_references.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getSearchEntityWithStrongConsistency} from "~/server/search/data/index/search_entity_index.js";
import {getAccountWithoutAvatar} from "~/server/spaces/get_account.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {intoApiContent} from "~/shared/api/content/into_api_content.js";
import {prepareApiMentionTitle} from "~/shared/api/content/prepare_api_mention_title.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {
    ContentReferencesFile,
    ContentReferencesSearchEntity,
} from "~/shared/content/content_references.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, FileId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    missingSearchEntityTitle,
    privateSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

export async function intoApiContentWithReferences(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    node: Node,
): Promise<ApiContentResponse> {
    const {content} = await intoApiContentWithReferencesAndReturnReferences(
        context,
        spaceId,
        fileAuthorizer,
        node,
    );
    return content;
}

export async function intoApiMessageContentWithReferences(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    node: MessageContent,
): Promise<ApiContentResponse> {
    const {content} = await intoApiContentWithReferencesAndReturnReferences(
        context,
        spaceId,
        // `MessageContent` doesn't have referenced files.
        "AssertHasNoFiles",
        node,
    );
    return content;
}

export async function intoApiContentWithReferencesAndReturnReferences(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    node: Node,
): Promise<{
    content: ApiContentResponse;
    references: {
        accountById: ReadonlyMap<AccountId, Omit<AccountModelWithoutSpaceData, "avatar">>;
        searchEntityById: ReadonlyMap<SearchMentionEntityId, ContentReferencesSearchEntity>;
        fileById: ReadonlyMap<FileId, ContentReferencesFile>;
    };
}> {
    // Content references are loaded with eventual consistency. We clearly document
    // this for public API users.
    const referencesContext = context.dynamo.unexpectStrongReadConsistency();

    const referencedIds = getContentReferencedIdsForNode(node);
    const searchEntityIds = Array.from(referencedIds.searchEntityIds);

    const [accounts, searchEntities, fileReferences] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId =>
                getAccountWithoutAvatar(referencesContext, spaceId, accountId),
            ),
        ),
        runAllPromises(
            mapIterable(searchEntityIds, entityId => {
                return referencesContext.searchInjection.getSearchMentionEntityIfPossible(
                    spaceId,
                    entityId,
                );
            }),
        ),
        runAllPromises(
            mapIterable(referencedIds.fileIds, fileId => {
                if (fileAuthorizer === "AssertHasNoFiles") {
                    throw new InternalError("Expected content to not include any referenced files");
                }
                return getContentFileReference(referencesContext, spaceId, fileId, fileAuthorizer);
            }),
        ),
    ]);

    const accountById = new Map(
        filterMapIterable(accounts, account => {
            if (!account) return;
            return [account.id, account];
        }),
    );

    const searchEntityById = new Map(
        filterMapIterable(searchEntities, (searchEntity, index) => {
            if (!searchEntity) return;
            const searchEntityId = searchEntityIds[index]!;
            return [searchEntityId, searchEntity];
        }),
    );

    const fileById = new Map(
        filterMapIterable(fileReferences, fileReference => {
            if (!fileReference) return;
            return [fileReference.file.id, fileReference];
        }),
    );

    const apiContent = intoApiContent(node, {
        getAccountMentionTitleIfExists: (accountId, {isShort}) => {
            const account = accountById.get(accountId);
            if (!account) return missingAccountName;
            if (!isShort) return account.name;
            return getAccountShortNameWithoutFullNameTooltip(account);
        },
        getSearchEntityMentionTitleIfExists: entityId => {
            const entityResult = searchEntityById.get(entityId);

            if (!entityResult) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            if (entityResult.isPrivate) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${privateSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            return prepareApiMentionTitle(
                entityId,
                entityResult.entity.initialData,
                account => account.initialData,
            );
        },
        getSearchTaskEntityDisplayStatusIfExists: taskId => {
            const entity = searchEntityById.get(`Task:${taskId}`);
            if (!entity) return;
            if (entity.isPrivate) return;

            assert(entity.entity.initialData.type === "Task");
            return entity.entity.initialData.task.displayStatus.value;
        },
        getFileIfExists: fileId => {
            const fileRef = fileById.get(fileId);
            if (!fileRef) return undefined;

            const preview = fileRef.file.initialData.preview;
            const size =
                preview !== null &&
                preview.type === "Image" &&
                preview.size !== "Error" &&
                preview.size !== "Processing" &&
                preview.size !== undefined
                    ? preview.size
                    : undefined;

            return {
                contentType: fileRef.file.initialData.contentType,
                contentLength: fileRef.file.initialData.contentLength,
                size,
            };
        },
    });

    return {
        content: apiContent,
        references: {
            accountById,
            searchEntityById,
            fileById,
        },
    };
}

export async function getApiMentionTitleWithStrongConsistency(
    context: ServerActionContext,
    spaceId: SpaceId,
    entityId: SearchMentionEntityId,
): Promise<{title: string}> {
    const entity = await getSearchEntityWithStrongConsistency(context, spaceId, entityId);

    return {
        title: prepareApiMentionTitle(entityId, entity, account => account.initialData),
    };
}

export async function getApiTaskMentionTitleWithStrongConsistency(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    taskEntityId: `Task:${TaskId}`,
): Promise<{title: string; displayStatus: TaskDisplayStatus}> {
    const entity = await getSearchEntityWithStrongConsistency(context, spaceId, taskEntityId);

    assert(entity.type === "Task");

    return {
        title: prepareApiMentionTitle(taskEntityId, entity, account => account.initialData),
        displayStatus: entity.task.displayStatus.value,
    };
}
