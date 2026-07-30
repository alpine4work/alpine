import {ShouldRevalidateFunction, useSearchParams} from "@remix-run/react";
import {useCallback, useEffect, useState} from "react";
import {createHeadMetaForRoomChat} from "~/app/helpers/create_head_meta.js";
import {
    deserializeChatIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {loadWithSpaceAndSiteDiscovery} from "~/app/helpers/load_with_space_and_site_discovery.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/_space.js";
import {ChatView} from "~/client/web/chat/chat_view.js";
import {getChatOrAccountSearchAffinityEntityId} from "~/client/web/chat/get_chat_or_account_search_affinity_entity_id.js";
import {Box} from "~/client/web/design/box.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {authorizeChatAccess} from "~/server/chat/data/authorize_chat_access.js";
import {createRoomChat} from "~/server/chat/data/create_room_chat.js";
import {getChatAndInitialMessages} from "~/server/chat/data/get_chat_and_initial_messages.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {getMessageDraft} from "~/server/messaging/drafts/get_message_draft.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {createRynamoItemSchema} from "~/shared/dynamo/rynamo_types.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    MessageDraftWithFilesSchema,
    emptyMessageDraftWithFiles,
} from "~/shared/messaging/message_draft_schema.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    key: Schema.id(),
    checkpoint: ServerSynchronizationCheckpointSchema,
    chat: ChatModel.schema(),
    initialIsSubscribed: Schema.boolean.nullable(),
    initialMessages: Schema.array(ChatMessageModel.schema()),
    initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    inboxEntry: createRynamoItemSchema(InboxEntryModelSchema).nullable(),
    isFavorite: Schema.boolean,
    messageDraft: MessageDraftWithFilesSchema,
});

function parseChatCreateSearchParam(createSearchParam: string): {
    spaceId: SpaceId;
    chatName: string;
} {
    const spaceIdSeparatorIndex = createSearchParam.indexOf(" ");
    const spaceIdString =
        spaceIdSeparatorIndex === -1
            ? createSearchParam
            : createSearchParam.slice(0, spaceIdSeparatorIndex);

    return {
        spaceId: deserializeSpaceIdForLoader(spaceIdString),
        chatName:
            spaceIdSeparatorIndex === -1 ? "" : createSearchParam.slice(spaceIdSeparatorIndex + 1),
    };
}

export async function loader({context: unauthenticatedContext, request, params}: LoaderArgs) {
    const context = await unauthenticatedContext.actor.authenticate();
    const chatId = deserializeChatIdForLoader(params.chatId ?? null);

    const url = new URL(request.url);

    const chatPromiseResolver = createPromiseResolver<ChatModel>();

    // Generate checkpoint before we start loading data. So when we backfill we include
    // any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const createSearchParam = url.searchParams.get("create");

    let createdChat: ChatModel | null = null;

    if (createSearchParam !== null) {
        const {spaceId, chatName} = parseChatCreateSearchParam(createSearchParam);
        context.discovery.discoverSpaceId(spaceId, "CreateSearchParam");

        try {
            const sessionContext = context.actor.authorizeSession();

            const chat = await createRoomChat(sessionContext, {
                spaceId,
                chatId,
                name: chatName,
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

    const {
        data1: [
            {chat, initialIsSubscribed, initialMessages, initialOtherReferencedMessages},
            inboxEntry,
            isFavorite,
            messageDraft,
        ],
        siteLoaderData,
    } = await loadWithSpaceAndSiteDiscovery(context, {
        request,
        entityId: `Chat:${chatId}`,
        load1: async ({onSiteId}) => {
            return await runAllPromises([
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
                          onSiteId,
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
                    ? chatPromiseResolver.promise.then(chat =>
                          getInboxEntry(context.actor.authorizeSession(), {
                              spaceId: chat.spaceId,
                              key: {type: "Chat", chatId},
                          }),
                      )
                    : null,

                chatPromiseResolver.promise.then(chat =>
                    isSearchFavoriteEntity(context, {
                        spaceId: chat.spaceId,
                        entityId: getChatOrAccountSearchAffinityEntityId(
                            "getAccountId" in context.actor
                                ? context.actor.getAccountId()
                                : undefined,
                            chat,
                        ),
                    }),
                ),
                chatPromiseResolver.promise.then(chat =>
                    context.actor.type === "Session"
                        ? getMessageDraft(context.actor.authorizeSession(), {
                              spaceId: chat.spaceId,
                              surface: {
                                  type: "Chat",
                                  chatId,
                              },
                          })
                        : emptyMessageDraftWithFiles,
                ),
            ]);
        },
        load2: async () => {},
    });

    return jsonWithSchema(
        LoaderSchema,
        {
            key: generateId(),
            checkpoint,
            chat,
            initialIsSubscribed,
            initialMessages,
            initialOtherReferencedMessages,
            inboxEntry,
            isFavorite,
            messageDraft,
        },
        {siteLoaderData},
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

    const spaceRouteData = getParentData("routes/_space", SpaceRouteLoaderSchema);

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
    const {key} = useLoaderDataWithSchema(LoaderSchema);
    return (
        <ChatRouteInner
            // We use a unique key to force a remount when we get new data from the server. We
            // added this specifically to support site-related access policy changes.
            //
            // When a chat's access policy is changed, the update will propagated to all
            // clients that have the channel loaded via their rynamo subscription.
            //
            // So if a Test Chat Room is added to a site while User A is viewing it, we call
            // `revalidate()` on User A's client. This reloads Test Chat Room's data, which
            // will also load the site data and store it at the space-level SiteContext. Once
            // the site data is added to the SiteContext, we can render the site chrome around
            // the chat room.
            key={key}
        />
    );
}

function ChatRouteInner() {
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        checkpoint,
        chat: chatFromLoader,
        initialIsSubscribed,
        initialMessages,
        initialOtherReferencedMessages,
        inboxEntry,
        isFavorite,
        messageDraft,
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

    const node = (
        <Box flexGrow="1" width="full" height="full" overflow="hidden">
            <ChatView
                // Remount whenever we navigate to a different chat.
                key={chat.id}
                withInboxBanner={!!inboxEntry}
                chat={chat}
                messageDraft={messageDraft}
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

    return useInboxBannerOutletContainer(
        {
            initialEntry: inboxEntry,
            maxWidth: contentStyles.contentMaxWidth,
        },
        node,
    );
}
