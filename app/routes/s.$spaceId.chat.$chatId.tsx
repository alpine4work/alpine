import {useSearchParams} from "@remix-run/react";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s.$spaceId.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name.js";
import {ChatView} from "~/client/chat/chat_view.js";
import {Box} from "~/client/design/box.js";
import {joinPrettyConjunctionList} from "~/client/design/pretty_conjunction_list.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {createMetaFunction} from "~/client/remix/create_meta_function.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {getChatAndInitialMessages} from "~/server/chat/data/chat_table.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

const LoaderSchema = Schema.object({
    chat: ChatModel.schema(),
    initialMessages: Schema.array(ChatMessageModel.schema()),
    initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
});

export async function loader({context: _context, params}: LoaderArgs) {
    const context = await _context.actor.authenticate();
    const chatId = Schema.id<ChatId>().deserialize(params.chatId ?? null);

    const {chat, initialMessages, initialOtherReferencedMessages} = await getChatAndInitialMessages(
        context.actor.authorizeSession(),
        {
            chatId,
            messagesLimit: getInitialLoadMessageCount(context.loader.clientInfo),
        },
    );

    const propagateEventData: TracerEventData = {
        context: {
            chatId,
        },
    };

    return jsonWithSchema(
        LoaderSchema,
        {chat, initialMessages, initialOtherReferencedMessages},
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
                              getAccountShortNameWithoutFullNameTooltip(account),
                          ),
                      )}${metaTitlePostfix}`,
        },
    ];
});

export default function ChatRoute({withMobileLayout}: {withMobileLayout?: boolean}) {
    const [searchParams] = useSearchParams();
    const {chat, initialMessages, initialOtherReferencedMessages} =
        useLoaderDataWithSchema(LoaderSchema);

    const messageIndexString = searchParams.get("message");
    const messageIndex = messageIndexString ? parseInt(messageIndexString, 10) : null;

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={!withMobileLayout ? {desktop: "4"} : undefined}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                backgroundColor="grey-0"
                borderRadius={!withMobileLayout ? {desktop: "md"} : undefined}
                boxShadow="elevation-5"
            >
                <ChatView
                    // Remount whenever we navigate to a different chat.
                    key={chat.id}
                    chat={chat}
                    initialMessages={initialMessages}
                    initialOtherReferencedMessages={initialOtherReferencedMessages}
                    initialScrollToMessageIndex={messageIndex}
                />
            </Box>
        </Box>
    );
}
