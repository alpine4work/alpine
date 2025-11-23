import {useSearchParams} from "@remix-run/react";
import {
    deserializeChatIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {ChatView} from "~/client/web/chat/chat_view.js";
import {Box} from "~/client/web/design/box.js";
import {useInboxBannerOutletContainer} from "~/client/web/inbox/use_inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/web/messaging/get_initial_load_message_count.js";
import {createMetaFunction} from "~/client/web/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/web/remix/use_loader_data_with_schema.js";
import {useSearchAffinityViewEntityInteraction} from "~/client/web/search/use_search_affinity_view_entity_interaction.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {getChatAndInitialMessages} from "~/server/chat/data/chat_actions.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {isSearchFavoriteEntity} from "~/server/search/data/table/search_entity_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";
import {
    ServerSynchronizationCheckpointSchema,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const LoaderSchema = Schema.object({
    checkpoint: ServerSynchronizationCheckpointSchema,
    chat: ChatModel.schema(),
    initialMessages: Schema.array(ChatMessageModel.schema()),
    initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
    isFavorite: Schema.boolean,
});

export async function loader({context: unauthenticatedContext, request, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const chatId = deserializeChatIdForLoader(params.chatId ?? null);

    const url = new URL(request.url);

    const chatPromiseResolver = createPromiseResolver<ChatModel>();

    // Generate checkpoint before we start loading data. So when we backfill we
    // include any realtime events that happened while loading data.
    const checkpoint = generateServerSynchronizationCheckpoint();

    const [{chat, initialMessages, initialOtherReferencedMessages}, inboxEntry, isFavorite] =
        await runAllPromises([
            getChatAndInitialMessages(context.actor.authorizeSession(), {
                chatId,
                messagesLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
                // Immediately resolve `chatPromiseResolver` once the chat is loaded. This
                // function may take longer to return as it loads messages from the chat.
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
                ? getInboxEntry(context, {
                      spaceId,
                      key: {type: "Chat", chatId},
                  })
                : null,
            chatPromiseResolver.promise.then(chat =>
                isSearchFavoriteEntity(context, {
                    spaceId,
                    entityId:
                        chat.accounts.length === 2
                            ? `Account:${
                                  chat.accounts.filter(
                                      account => account.id !== context.actor.getAccountId(),
                                  )[0]!.id
                              }`
                            : `Chat:${chat.id}`,
                }),
            ),
        ]);

    const propagateEventData: TracerEventData = {
        context: {
            chatId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {checkpoint, chat, initialMessages, initialOtherReferencedMessages, inboxEntry, isFavorite},
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {chat}, getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    assert(chat.accounts.length > 0);
    const otherChatAccounts = chat.accounts.filter(
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
                              // Account name in title won't update when account changes without reload
                              // because we're using `initialData`.
                              getAccountShortNameWithoutFullNameTooltip(account.initialData),
                          ),
                      )}`,
        },
    ];
});

export default function ChatRoute() {
    const [searchParams] = useSearchParams();
    const {
        checkpoint,
        chat,
        initialMessages,
        initialOtherReferencedMessages,
        inboxEntry,
        isFavorite,
    } = useLoaderDataWithSchema(LoaderSchema);

    const {currentAccount} = useSpaceContext();

    const messageIndexString = searchParams.get("message");
    const messageIndex = messageIndexString ? parseInt(messageIndexString, 10) : null;

    // If you're spending time in a 1:1 chat, then we give affinity points to the
    // account you're messaging. Not the chat itself. The page we route you to for
    // an account in search is currently your 1:1 chat with the account anyways.
    //
    // By accruing points to the account we allow chat conversations to affect
    // account selector type-ahead affinity rankings.
    useSearchAffinityViewEntityInteraction(
        currentAccount && chat.accounts.length === 2
            ? `Account:${chat.accounts.filter(account => account.id !== currentAccount.id)[0]!.id}`
            : `Chat:${chat.id}`,
    );

    const node = (
        <Box flexGrow="1" width="full" height="full" overflow="hidden">
            <ChatView
                // Remount whenever we navigate to a different chat.
                key={chat.id}
                withInboxBanner={!!inboxEntry}
                chat={chat}
                initialCheckpoint={checkpoint}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={messageIndex}
                initialIsFavorite={isFavorite}
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
