import {useSearchParams} from "@remix-run/react";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {ChatView} from "~/client/chat/chat_view.js";
import {Box} from "~/client/design/box.js";
import {InboxBannerOutletContainer} from "~/client/inbox/inbox_banner_outlet_container.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSearchAffinityViewInteraction} from "~/client/search/use_search_affinity_view_interaction.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getChatAndInitialMessages} from "~/server/chat/data/chat_table.js";
import {getInboxEntry} from "~/server/notifications/data/notifications_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {createDynamoGeneralRealtimeItemSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryModelSchema} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {messageViewMaxWidth} from "~/shared/styles/messaging_shared_styles.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    chat: ChatModel.schema(),
    initialMessages: Schema.array(ChatMessageModel.schema()),
    initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
    inboxEntry: createDynamoGeneralRealtimeItemSchema(InboxEntryModelSchema).nullable(),
});

export async function loader({context: unauthenticatedContext, request, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const chatId = Schema.id<ChatId>().deserialize(params.chatId ?? null);

    const url = new URL(request.url);

    const [{chat, initialMessages, initialOtherReferencedMessages}, inboxEntry] =
        await runAllPromises([
            getChatAndInitialMessages(context.actor.authorizeSession(), {
                chatId,
                messagesLimit: getInitialLoadMessageCount(context.loader.getClientInfo()),
            }),
            url.searchParams.get("inbox") === "show"
                ? getInboxEntry(context, {
                      spaceId,
                      key: {type: "Chat", chatId},
                  })
                : null,
        ]);

    const propagateEventData: TracerEventData = {
        context: {
            chatId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {chat, initialMessages, initialOtherReferencedMessages, inboxEntry},
        {propagateEventData},
    );
}

export const meta = createMetaFunction(LoaderSchema, ({data: {chat}, getParentData}) => {
    const spaceRouteData = getParentData("routes/s.$spaceId", SpaceRouteLoaderSchema);

    assert(chat.accounts.length > 0);
    const otherChatAccounts = chat.accounts.filter(
        account => account.id !== spaceRouteData?.currentAccount.id,
    );

    return [
        {
            title:
                otherChatAccounts.length === 0
                    ? `Chat with yourself${metaTitlePostfix}`
                    : `Chat with ${joinPrettyConjunctionList(
                          otherChatAccounts.map(account =>
                              // Account name in title won't update when account changes without reload
                              // because we're using `initialData`.
                              getAccountShortNameWithoutFullNameTooltip(account.initialData),
                          ),
                      )}${metaTitlePostfix}`,
        },
    ];
});

export default function ChatRoute({
    withMobileLayout: withMobileLayoutProp = false,
}: {
    withMobileLayout?: boolean;
}) {
    const [searchParams] = useSearchParams();
    const {chat, initialMessages, initialOtherReferencedMessages, inboxEntry} =
        useLoaderDataWithSchema(LoaderSchema);

    const isMobile = useIsMobile();
    const {currentAccount} = useSpaceContext();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const messageIndexString = searchParams.get("message");
    const messageIndex = messageIndexString ? parseInt(messageIndexString, 10) : null;

    // If you're spending time in a 1:1 chat, then we give affinity points to the
    // account you're messaging. Not the chat itself. The page we route you to for
    // an account in search is currently your 1:1 chat with the account anyways.
    //
    // By accruing points to the account we allow chat conversations to affect
    // account selector type-ahead affinity rankings.
    useSearchAffinityViewInteraction(
        chat.accounts.length === 2
            ? `Account:${chat.accounts.filter(account => account.id !== currentAccount.id)[0]!.id}`
            : `Chat:${chat.id}`,
    );

    const node = (
        <Box flexGrow="1" width="full" height="full" overflow="hidden">
            <ChatView
                // Remount whenever we navigate to a different chat.
                key={chat.id}
                withMobileLayout={withMobileLayout}
                chat={chat}
                initialMessages={initialMessages}
                initialOtherReferencedMessages={initialOtherReferencedMessages}
                initialScrollToMessageIndex={messageIndex}
            />
        </Box>
    );

    if (!inboxEntry) {
        return node;
    } else {
        return (
            <InboxBannerOutletContainer
                initialEntry={inboxEntry}
                maxWidth={messageViewMaxWidth}
                // Since chats have a permanent top bar, use `grey-5` border to create the
                // illusion that the banner is of the same physical material.
                borderBottom="grey-5"
            >
                {node}
            </InboxBannerOutletContainer>
        );
    }
}
