/**
 * Bazel prevents packages from having cyclic dependencies. This is a good
 * thing! Cyclic dependencies increase bundle size, increase type checking
 * time, and generally make code a mess to deal with.
 *
 * However, quite often our features need to integrate with one another. For
 * example, when we're adding an account to a space in `//server/spaces`, we
 * want to add some default favorite search entities with functions from
 * `//server/search`. However, `//server/search` depends on `//server/spaces`
 * and we can't add a cyclic dependency!
 *
 * The solution: Dependency injection. That's where injection context modules
 * come into play. Injection context modules declare a bunch of functions we
 * want to use from across the backend codebase in ways that break the
 * dependency graph. In production, we provide the proper implementation for
 * each injected function. In tests we either mock injected functions or throw
 * an error.
 *
 * IMPORTANT: Only use this module if you specifically can't take the Bazel
 * package which originally defines the function as a dependency since it'll
 * create a circular dependency. And there's no way to refactor Bazel packages
 * such that you can eliminate the circular dependency.
 */

import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {TaskContextModuleActionTransaction} from "~/server/context/task_context_module_base.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {Context, ContextModulesType} from "~/shared/context/context.js";
import {ContextModuleBase as _ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {ErrorBase, UnimplementedError} from "~/shared/error/error.js";
import {ChannelOrMetadataModel} from "~/shared/forum/channel_model.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    AccountId,
    ChannelId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
} from "~/shared/id/types/id_types.js";
import {SearchAffinityEntityId, SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

// HACK(calebmer): For some reason Vite in hot reload mode doesn't like it when
// we try to reference `ContextModuleBase` in `createInjectionContextModule()`
// if `ContextModuleBase` isn't declared as a `const`.
const ContextModuleBase = _ContextModuleBase;
type ContextModuleBase<Modules extends {[key: string]: ContextModuleBase | undefined} = {}> =
    _ContextModuleBase<Modules>;

export type DocumentsInjectionContextModule = InstanceType<typeof DocumentsInjectionContextModule>;

export const DocumentsInjectionContextModule = createInjectionContextModule<DocumentsInjection>({
    authorizeDocumentAccessIfPossible: true,
    getDocumentContentPreviewIfPossible: true,
});

export type DocumentsInjection = {
    authorizeDocumentAccessIfPossible(
        context: ServerActionContext,
        documentId: DocumentId,
        expectedAccessLevel: AccessLevel,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<
        Result<
            {spaceId: SpaceId; creatorId: AccountId | null; accessPolicy: AccessPolicy},
            ErrorBase
        >
    >;

    getDocumentContentPreviewIfPossible(
        context: ServerActionContext,
        documentId: DocumentId,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<Result<
        {
            version: number;
            titleWithoutFallback: string;
            preview: {version: number; content: DocumentContentWithReferences} | null;
        },
        ErrorBase
    > | null>;
};

export type ForumInjectionContextModule = InstanceType<typeof ForumInjectionContextModule>;

export const ForumInjectionContextModule = createInjectionContextModule<ForumInjection>({
    authorizeChannelAccessIfPossible: true,
    getChannelAndMetadataIfPossible: true,
    isSubscribedToChannel: true,
    getPostIfPossible: true,
});

export type ForumInjection = {
    authorizeChannelAccessIfPossible(
        context: ServerActionContext,
        channelId: ChannelId,
        expectedAccessLevel: AccessLevel,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<Result<{spaceId: SpaceId; accessPolicy: AccessPolicy}, ErrorBase>>;

    getChannelAndMetadataIfPossible(
        context: ServerActionContext,
        options: {
            channelId: ChannelId;
            postFilesLimit: number;
            afterItemKey?: DynamoItemKey | null;
            consistency?: DynamoReadConsistency;
        },
    ): Promise<Result<DynamoGeneralRealtimeQueryResult<ChannelOrMetadataModel>, ErrorBase> | null>;

    isSubscribedToChannel(
        context: ServerSessionActionContext,
        channelId: ChannelId,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<boolean>;

    getPostIfPossible(
        context: ServerActionContext,
        postId: PostId,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<Result<DynamoGeneralRealtimeItem<PostModel>, ErrorBase>>;
};

export type SearchInjectionContextModule = InstanceType<typeof SearchInjectionContextModule>;

export const SearchInjectionContextModule = createInjectionContextModule<SearchInjection>({
    getSearchMentionEntityIfPossible: true,
    dangerouslyFavoriteSearchEntityWithoutAuthorization: true,
});

export type SearchInjection = {
    getSearchMentionEntityIfPossible(
        context: ServerSessionActionContext,
        spaceId: SpaceId,
        entityId: SearchMentionEntityId,
    ): Promise<{isPrivate: false; entity: SearchEntityModel} | {isPrivate: true} | null>;

    dangerouslyFavoriteSearchEntityWithoutAuthorization(
        context: DynamoContext,
        options: {
            spaceId: SpaceId;
            accountId: AccountId;
            entityId: SearchAffinityEntityId;
        },
    ): Promise<unknown>;
};

export type SpacesInjectionContextModule = InstanceType<typeof SpacesInjectionContextModule>;

export const SpacesInjectionContextModule = createInjectionContextModule<SpacesInjection>({
    getOurAccountSpaceIds: true,
});

export type SpacesInjection = {
    getOurAccountSpaceIds(context: ServerSessionActionContext): Promise<{
        spaceIds: ReadonlySet<SpaceId>;
        getConditionCheckTransactionEntry: () => DynamoTransactionEntry | null;
    }>;
};

export type TasksInjectionContextModule = InstanceType<typeof TasksInjectionContextModule>;

export const TasksInjectionContextModule = createInjectionContextModule<TasksInjection>({
    indexTaskActionTransactionAssumingItsCommitted: true,
    authorizeTaskCollectionAccessIfPossible: true,
    internalGetUpdateOurAccountNameTaskTransactionEntries: true,
});

export type TasksInjection = {
    indexTaskActionTransactionAssumingItsCommitted(
        context: ServerSystemActionContext,
        actionTransaction: TaskContextModuleActionTransaction,
    ): Promise<void>;

    authorizeTaskCollectionAccessIfPossible(
        context: ServerActionContext,
        collectionId: TaskCollectionId,
        expectedAccessLevel: AccessLevel,
    ): Promise<Result<{spaceId: SpaceId}, ErrorBase> | null>;

    internalGetUpdateOurAccountNameTaskTransactionEntries(
        context: ServerSessionActionContext,
        options: {
            spaceIds: ReadonlySet<SpaceId>;
            name: string;
            nameVersion: number;
        },
    ): Array<DynamoTransactionEntry>;
};

type ArrayTail<T extends ReadonlyArray<unknown>> = T extends readonly [any, ...infer U] ? U : [];

/**
 * Class returned by `createInjectionContextModule()`.
 */
type InjectionContextModuleClass<
    Injection extends {[key: string]: (context: Context<any>, ...args: Array<any>) => any},
> = {
    new (injections: Injection): InjectionContextModuleInstance<Injection>;

    /**
     * Create an injection context module for tests. Throws an error for any
     * unimplemented injections.
     */
    test(injections?: Partial<Injection>): InjectionContextModuleInstance<Injection>;
};

/**
 * An injection context module instance. Has a method for every injection
 * function. The method expects the context to be of the correct type.
 */
type InjectionContextModuleInstance<
    Injection extends {[key: string]: (context: Context<any>, ...args: Array<any>) => any},
> = ContextModuleBase &
    ForkableContextModuleBase & {
        /**
         * Create a copy but replace some injections with new implementations.
         */
        cloneForTest(injections?: Partial<Injection>): InjectionContextModuleInstance<Injection>;

        fork(): InjectionContextModuleInstance<Injection>;
    } & {
        [Key in keyof Injection]: (
            this: ContextModuleBase<ContextModulesType<Parameters<Injection[Key]>[0]>>,
            ...args: ArrayTail<Parameters<Injection[Key]>>
        ) => ReturnType<Injection[Key]>;
    };

function createInjectionContextModule<
    Injection extends {[key: string]: (...args: Array<any>) => any},
>(
    // Use `Record` to use TypeScript to force the caller to explicitly list out
    // each injection.
    injectionKeysObject: Record<keyof Injection, true>,
): InjectionContextModuleClass<Injection> {
    const injectionKeys = Object.keys(injectionKeysObject);

    class InjectionContextModule extends ContextModuleBase implements ForkableContextModuleBase {
        private readonly _injection: Injection;

        constructor(injection: Injection) {
            super();
            this._injection = injection;
        }

        public static test(injection?: Partial<Injection>) {
            assert(process.env.NODE_ENV === "test");

            return new InjectionContextModule(
                createObjectFromKeys(
                    injectionKeys,
                    injectionKey =>
                        injection?.[injectionKey] ??
                        (() => {
                            throw new UnimplementedError(
                                quote`${injectionKey} hasn’t been injected for this test`,
                            );
                        }),
                ) as any,
            );
        }

        public cloneForTest(injection?: Partial<Injection>) {
            assert(process.env.NODE_ENV === "test");

            return new InjectionContextModule(
                mapObjectValues(
                    this._injection,
                    (injectionFunction, injectionKey) =>
                        injection?.[injectionKey] ?? injectionFunction,
                ) as any,
            );
        }

        public fork() {
            return new InjectionContextModule(this._injection);
        }
    }

    for (const injectionKey of injectionKeys) {
        (InjectionContextModule.prototype as any)[injectionKey] = function (...args: Array<any>) {
            return this._injection[injectionKey].call(undefined, this._context, ...args);
        };
    }

    return InjectionContextModule as InjectionContextModuleClass<Injection>;
}
