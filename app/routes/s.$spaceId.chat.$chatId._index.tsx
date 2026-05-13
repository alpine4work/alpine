import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {useCallback, useEffect, useState} from "react";
import {createHeadMetaForRoomChat} from "~/app/helpers/create_head_meta.js";
import {
    deserializeChatIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {ChatView} from "~/client/web/chat/chat_view.js";
import {getChatOrAccountSearchAffinityEntityId} from "~/client/web/chat/get_chat_or_account_search_affinity_entity_id.js";
import {Box} from "~/client/web/design/box.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSiteChromeContainer} from "~/client/web/sites/use_site_chrome_container.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {getChatAndInitialMessages} from "~/server/chat/data/get_chat_and_initial_messages.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getSite} from "~/server/sites/data/get_site.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {createSiteLoaderDataPrefetcher} from "~/shared/remix/create_site_loader_data_prefetcher.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    checkpoint: ServerSynchronizationCheckpointSchema,
    chat: ChatModel.schema(),
    initialIsSubscribed: Schema.boolean.nullable(),
    initialMessages: Schema.array(ChatMessageModel.schema()),
    initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
    isFavorite: Schema.boolean,
});

export async function loader({context: unauthenticatedContext, request, params}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const chatId = deserializeChatIdForLoader(params.chatId ?? null);

    const url = new URL(request.url);

    const chatPromiseResolver = createPromiseResolver<ChatModel>();

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const createSearchParam = url.searchParams.get("create");

    let createdChat: ChatModel | null = null;

    const sitePrefetcher = createSiteLoaderDataPrefetcher({
        request,
        entityId: `Chat:${chatId}`,
        fetchSite: siteId => getSite(context, {siteId}),
    });

    if (createSearchParam !== null) {
        try {
            const sessionContext = context.actor.authorizeSession();

            // TODO(#sites): We probably want to add a search param if the chat room is being
            // directly added to a site (create within site).
            const chat = await createRoomChat(sessionContext, {
                spaceId,
                chatId,
                name: createSearchParam,
                accessPolicy: {
                    type: "Local",
                    accountGrantById: new Map([
                        [sessionContext.actor.getAccountId(), {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: !url.searchParams.has("private")
                        ? {level: "Manage", generation: 1}
                        : null,
                    urlGrant: null,
                },
            });

            createdChat = await chat.get();
        } catch (error) {
            if (!isDynamoConditionCheckError(error)) {
                throw error;
            }

            // If there was an issue creating our chat, it might be because the chat already
            // exists. Attempt to authorize, if that fails we believe the issue was actually
            // with chat creation.
            //
            // This check makes this `GET` endpoint idempotent. You can hit the endpoint
            // multiple times and if our chat is already created we'll noop.
            try {
                await authorizeChatAccess(context, chatId, "View", {consistency: "Strong"});
            } catch {
                throw error;
            }
        }
    }

    const [
        {chat, initialIsSubscribed, initialMessages, initialOtherReferencedMessages},
        inboxEntry,
        isFavorite,
    ] = await runAllPromises([
        createdChat
            ? (() => {
                  chatPromiseResolver.resolve(createdChat);

                  return {
                      chat: createdChat,
                      initialIsSubscribed: true,
                      initialMessages: [],
                      initialOtherReferencedMessages: [],
                  };
              })()
            : getChatAndInitialMessages(context, {
                  chatId,
                  messagesLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
                  onSiteId: sitePrefetcher.onSiteId,
                  // Immediately resolve `chatPromiseResolver` once the chat is loaded. This function
                  // may take longer to return as it loads messages from the chat.
                  onChat: chatPromiseResolver.resolve,
              }).then(
                  result => {
                      chatPromiseResolver.resolve(result.chat);
                      return result;
                  },
                  error => {
                      chatPromiseResolver.reject(error);
                      throw error;
                  },
              ),

        url.searchParams.get("inbox") === "show"
            ? getInboxEntry(context.actor.authorizeSession(), {
                  spaceId,
                  key: {type: "Chat", chatId},
              })
            : null,

        chatPromiseResolver.promise.then(chat =>
            isSearchFavoriteEntity(context, {
                spaceId,
                entityId: getChatOrAccountSearchAffinityEntityId(
                    "getAccountId" in context.actor ? context.actor.getAccountId() : undefined,
                    chat,
                ),
            }),
        ),
    ]);

    return jsonWithSchema(
        LoaderSchema,
        {
            checkpoint,
            chat,
            initialIsSubscribed,
            initialMessages,
            initialOtherReferencedMessages,
            inboxEntry,
            isFavorite,
        },
        {
            siteLoaderData: await sitePrefetcher.get(),
        },
    );
}

// We don't need to reload when certain search params change.
export const shouldRevalidate: ShouldRevalidateFunction = ({
    currentUrl: immutableCurrentUrl,
    nextUrl: immutableNextUrl,
}) => {
    const currentUrl = new URL(immutableCurrentUrl);
    const nextUrl = new URL(immutableNextUrl);

    // Used to initially focus the chat:
    nextUrl.searchParams.delete("focus");
    currentUrl.searchParams.delete("focus");

    // Used to create a chat room:
    nextUrl.searchParams.delete("create");
    currentUrl.searchParams.delete("create");
    nextUrl.searchParams.delete("private");
    currentUrl.searchParams.delete("private");

    return nextUrl.toString() !== currentUrl.toString();
};

export const meta = createMetaFunction(LoaderSchema, ({data: {chat}, getParentData}) => {
    if (chat.definition.type === "Room") {
        return createHeadMetaForRoomChat(chat.definition);
    }

    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    assert(chat.definition.accounts.length > 0);
    const otherChatAccounts = chat.definition.accounts.filter(
        account =>
            spaceRouteData?.type !== "WithAccess" ||
            account.id !== spaceRouteData?.currentAccount.id,
    );

    return [
        {
            title:
                otherChatAccounts.length === 0
                    ? "Chat with yourself"
                    : `Chat with ${joinPrettyConjunctionList(
                          otherChatAccounts.map(account =>
                              // Account name in title won't update when account changes without reload because
                              // we're using `initialData`.
                              getAccountShortNameWithoutFullNameTooltip(account.initialData),
                          ),
                      )}`,
        },
    ];
});

export default function ChatRoute() {
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        checkpoint,
        chat: chatFromLoader,
        initialIsSubscribed,
        initialMessages,
        initialOtherReferencedMessages,
        inboxEntry,
        isFavorite,
    } = useLoaderDataWithSchema(LoaderSchema);

    const {currentAccount} = useSpaceContext();

    const [chat, setChat] = useState(chatFromLoader);

    if (chat.id !== chatFromLoader.id || chat.version < chatFromLoader.version) {
        setChat(chatFromLoader);
    }

    const handleUpdateChat = useCallback((newChat: ChatModel) => {
        setChat(oldChat => {
            // Don't allow child components to change the `ChatId` we're rendering.
            if (newChat.id !== oldChat.id) return oldChat;

            // Only use `newChat` if it has a higher version.
            if (oldChat.version >= newChat.version) return oldChat;

            return newChat;
        });
    }, []);

    const messageIndexString = searchParams.get("message");
    const messageIndex = messageIndexString ? parseInt(messageIndexString, 10) : null;

    const focusSearchParam = searchParams.get("focus");
    const [initiallyFocus] = useState(focusSearchParam !== null);

    const hasSearchParamToDelete =
        searchParams.has("focus") || searchParams.has("create") || searchParams.has("private");
    useEffect(() => {
        if (hasSearchParamToDelete) {
            setSearchParams(
                oldSearchParams => {
                    const newSearchParams = new URLSearchParams(oldSearchParams);
                    newSearchParams.delete("focus");
                    newSearchParams.delete("create");
                    newSearchParams.delete("private");
                    return newSearchParams;
                },
                {replace: true},
            );
        }
    }, [hasSearchParamToDelete, setSearchParams]);

    // If you're spending time in a 1:1 chat, then we give affinity points to the
    // account you're messaging. Not the chat itself. The page we route you to for an
    // account in search is currently your 1:1 chat with the account anyways.
    //
    // By accruing points to the account we allow chat conversations to affect account
    // selector type-ahead affinity rankings.
    useSearchAffinityViewEntityInteraction(
        getChatOrAccountSearchAffinityEntityId(currentAccount?.id, chat),
    );

    let node = (
        <Box flexGrow="1" width="full" height="full" overflow="hidden">
            <ChatView
                // Remount whenever we navigate to a different chat.
                key={chat.id}
                withInboxBanner={!!inboxEntry}
                chat={chat}
                onUpdateChat={handleUpdateChat}
                initialIsSubscribed={initialIsSubscribed}
                initialCheckpoint={checkpoint}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={messageIndex}
                initialIsFavorite={isFavorite}
                initiallyFocus={initiallyFocus}
            />
        </Box>
    );

    node = useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
        },
        node,
    );

    node = useSiteChromeContainer({entityId: `Chat:${chat.id}`}, node);
    return node;
}
