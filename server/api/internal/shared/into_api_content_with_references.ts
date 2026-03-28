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
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {
    ApiContentMarkdownIntoOptionsWithoutKeys,
    intoApiContent,
} from "~/shared/api/content/into_api_content.js";
import {prepareApiMentionTitle} from "~/shared/api/content/prepare_api_mention_title.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
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

type IntoApiContentWithReferencesOptions = {
    encoder: ApiContentKeyEncoder;
    posOffset?: number;
};

type IntoApiContentWithReferencesOptionsWithoutKeys = {
    encoder?: undefined;
    posOffset?: undefined;
};

type IntoApiContentWithReferencesOptionsForConversion =
    | IntoApiContentWithReferencesOptions
    | IntoApiContentWithReferencesOptionsWithoutKeys;

type IntoApiMessageContentWithReferencesOptions = {
    spaceId: SpaceId;
    node: MessageContent;
} & IntoApiContentWithReferencesOptions;

type IntoApiMessageContentWithReferencesOptionsWithoutKeys = {
    spaceId: SpaceId;
    node: MessageContent;
} & IntoApiContentWithReferencesOptionsWithoutKeys;

type IntoApiMessageContentWithReferencesOptionsForConversion =
    | IntoApiMessageContentWithReferencesOptions
    | IntoApiMessageContentWithReferencesOptionsWithoutKeys;

type IntoApiContentResponseForOptions<Options> = Options extends IntoApiContentWithReferencesOptions
    ? ApiContentResponse
    : ApiContentResponseWithoutKeys;

type IntoApiContentWithReferencesResult<Content> = {
    content: Content;
    references: {
        accountById: ReadonlyMap<AccountId, Omit<AccountModelWithoutSpaceData, "avatar">>;
        searchEntityById: ReadonlyMap<SearchMentionEntityId, ContentReferencesSearchEntity>;
        fileById: ReadonlyMap<FileId, ContentReferencesFile>;
    };
};

type IntoApiContentWithReferencesResultForOptions<Options> = IntoApiContentWithReferencesResult<
    IntoApiContentResponseForOptions<Options>
>;

/**
 * Converts content and loads its references while guaranteeing content keys on
 * paragraphs and headings unless `WithoutKeys` options are used.
 *
 * TODO: make these args an object per our style guide
 */
export async function intoApiContentWithReferences<
    Options extends IntoApiContentWithReferencesOptionsForConversion =
        IntoApiContentWithReferencesOptionsWithoutKeys,
>(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    node: Node,
    ...optionsArgs: Options extends IntoApiContentWithReferencesOptions
        ? [options: Options]
        : [options?: Options]
): Promise<IntoApiContentResponseForOptions<Options>> {
    const options: IntoApiContentWithReferencesOptionsForConversion = optionsArgs[0] ?? {};

    if (options.encoder === undefined) {
        const {content} = await intoApiContentWithReferencesAndReturnReferences(
            context,
            spaceId,
            fileAuthorizer,
            node,
        );
        // This cast is acknowledged as type unsafe. This branch asserts that keys are not
        // needed. To provide a tight contract between this logic and callers while keeping
        // this logic type-maintainable, we require this generic boundary cast. If this
        // branch changes, assert whether keys are needed before returning.
        return content as IntoApiContentResponseForOptions<Options>;
    }

    const {content} = await intoApiContentWithReferencesAndReturnReferences(
        context,
        spaceId,
        fileAuthorizer,
        node,
        options,
    );
    // This cast is acknowledged as type unsafe. The branch above asserts that keyed
    // options are present, and the shared converter asserts keyed content before
    // returning. To provide a tight contract between this logic and callers while
    // keeping this logic type-maintainable, we require this generic boundary cast. If
    // this branch changes, assert whether keys are needed before returning.
    return content as IntoApiContentResponseForOptions<Options>;
}

/**
 * Converts message content and loads mention references while guaranteeing content
 * keys unless `WithoutKeys` options are used.
 */
export async function intoApiMessageContentWithReferences<
    Options extends IntoApiMessageContentWithReferencesOptionsForConversion,
>(
    context: ServerAccountActionContext,
    options: Options,
): Promise<IntoApiContentResponseForOptions<Options>> {
    const {spaceId, node} = options;

    if (options.encoder === undefined) {
        const {content} = await intoApiContentWithReferencesAndReturnReferences(
            context,
            spaceId,
            // `MessageContent` doesn't have referenced files.
            "AssertHasNoFiles",
            node,
        );
        // This cast is acknowledged as type unsafe. This branch asserts that keys are not
        // needed. To provide a tight contract between this logic and callers while keeping
        // this logic type-maintainable, we require this generic boundary cast. If this
        // branch changes, assert whether keys are needed before returning.
        return content as IntoApiContentResponseForOptions<Options>;
    }

    const {content} = await intoApiContentWithReferencesAndReturnReferences(
        context,
        spaceId,
        // `MessageContent` doesn't have referenced files.
        "AssertHasNoFiles",
        node,
        {
            encoder: options.encoder,
            posOffset: options.posOffset,
        },
    );
    // This cast is acknowledged as type unsafe. The branch above asserts that keyed
    // options are present, and the shared converter asserts keyed content before
    // returning. To provide a tight contract between this logic and callers while
    // keeping this logic type-maintainable, we require this generic boundary cast. If
    // this branch changes, assert whether keys are needed before returning.
    return content as IntoApiContentResponseForOptions<Options>;
}

/**
 * Converts content, returns the loaded references, and guarantees content keys
 * unless `WithoutKeys` options are used.
 *
 * TODO: make these args an object per our style guide
 */
export async function intoApiContentWithReferencesAndReturnReferences<
    Options extends IntoApiContentWithReferencesOptionsForConversion =
        IntoApiContentWithReferencesOptionsWithoutKeys,
>(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    fileAuthorizer: FileAuthorizer | "AssertHasNoFiles",
    node: Node,
    ...optionsArgs: Options extends IntoApiContentWithReferencesOptions
        ? [options: Options]
        : [options?: Options]
): Promise<IntoApiContentWithReferencesResultForOptions<Options>> {
    const options: IntoApiContentWithReferencesOptionsForConversion = optionsArgs[0] ?? {};

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

    const intoApiContentOptions: ApiContentMarkdownIntoOptionsWithoutKeys = {
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

            // NOCOMMIT: Add author name to post title?
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
            return fileRef.file.initialData;
        },
    };

    const apiContent =
        options.encoder !== undefined
            ? intoApiContent(node, {
                  ...intoApiContentOptions,
                  encoder: options.encoder,
                  posOffset: options.posOffset,
              })
            : intoApiContent(node, intoApiContentOptions);

    return {
        content: apiContent,
        references: {
            accountById,
            searchEntityById,
            fileById,
        },
        // This cast is acknowledged as type unsafe. The `apiContent` construction above
        // asserts whether keys are needed before calling the shared converter. To provide
        // a tight contract between this logic and callers while keeping this logic
        // type-maintainable, we require this generic boundary cast. If this logic changes,
        // assert whether keys are needed before returning.
    } as IntoApiContentWithReferencesResultForOptions<Options>;
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
