import {Node} from "prosemirror-model";
import {intoApiContent} from "~/server/api/content/into_api_content.js";
import {getContentFileReference} from "~/server/content/get_content_references.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {ApiContentResponse} from "~/shared/api/types/api_specification_convenience_types.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {
    ContentReferencesFile,
    ContentReferencesSearchEntity,
} from "~/shared/content/content_references.js";
import {truncateContentMentionText} from "~/shared/content/truncate_content_mention_text.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    deletedSearchEntityTitle,
    missingSearchEntityTitle,
    privateSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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
        accountById: ReadonlyMap<AccountId, AccountModel>;
        searchEntityById: ReadonlyMap<SearchMentionEntityId, ContentReferencesSearchEntity>;
        fileById: ReadonlyMap<FileId, ContentReferencesFile>;
    };
}> {
    // Content references are loaded with eventual consistency. We clearly
    // document this for public API users.
    const referencesContext = context.dynamo.unexpectStrongReadConsistency();

    const referencedIds = getContentReferencedIdsForNode(node);
    const searchEntityIds = Array.from(referencedIds.searchEntityIds);

    const [accounts, searchEntities, fileReferences] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId =>
                getAccount(referencesContext, spaceId, accountId),
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

    // NOTE(calebmer): `intoApiContent()` doesn't currently use `fileById` but it
    // will eventually.
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
            if (!isShort) return account.initialData.name;
            return getAccountShortNameWithoutFullNameTooltip(account.initialData);
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

            const entity = entityResult.entity.initialData;

            // If `title` is null then we assume the entity was deleted. Otherwise, all
            // mentionable entities should have a non-null title.
            if (entity.title === null) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${deletedSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            let entityTitle = truncateContentMentionText(entity.title);

            if (entityTitle.length === 0) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            // Posts start with "in ${channelName}: " and expect client rendering code to
            // add the post author name to the start of the title.
            if (entity.media?.type === "Account" && entityId.startsWith("Post:")) {
                entityTitle = `${getAccountShortNameWithoutFullNameTooltip(
                    entity.media.account.initialData,
                )} ${entityTitle}`;
            }

            return entityTitle;
        },
        getSearchTaskEntityDisplayStatusIfExists: taskId => {
            const entity = searchEntityById.get(`Task:${taskId}`);
            if (!entity) return;
            if (entity.isPrivate) return;
            if (entity.entity.initialData.media?.type !== "TaskDisplayStatus") return;
            return entity.entity.initialData.media.displayStatus;
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
