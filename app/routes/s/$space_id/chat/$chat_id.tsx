import {useSearchParams} from "@remix-run/react";
import {LoaderSchema as SpaceRouteLoaderSchema} from "~/app/routes/s/$space_id";
import {getAccountShortNameWithoutFullNameTooltip} from "~/client/accounts/account_short_name";
import {ChatView} from "~/client/chat/chat_view";
import {Box} from "~/client/design/box";
import {joinPrettyConjunctionList} from "~/client/design/pretty_conjunction_list";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view";
import {createMetaFunction} from "~/client/remix/create_meta_function";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {getChatAndInitialMessages} from "~/server/dynamo/chat_table";
import {jsonWithSchema} from "~/server/remix/json_with_schema";
import {LoaderArgs} from "~/server/remix/loader_context";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model";
import {assert} from "~/shared/helpers/control/assert";
import {ChatId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

const LoaderSchema = Schema.object({
    chat: ChatModel.schema(),
    initialMessages: Schema.array(ChatMessageModel.schema()),
    initialOtherReferencedMessages: Schema.array(ChatMessageModel.schema()),
});

export async function loader({context: _context, params}: LoaderArgs) {
    const context = await _context.actor.authenticate();
    const chatId = Schema.id<ChatId>().deserialize(params.chat_id ?? null);

    const {chat, initialMessages, initialOtherReferencedMessages} = await getChatAndInitialMessages(
        context,
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

export const meta = createMetaFunction(LoaderSchema, ({data: {chat}, getParentsData}) => {
    const spaceRouteData = getParentsData("routes/s/$space_id", SpaceRouteLoaderSchema);

    assert(chat.accounts.length > 0);
    const otherChatAccounts = chat.accounts.filter(
        account => account.id !== spaceRouteData?.currentAccount.id,
    );

    return {
        title:
            otherChatAccounts.length === 0
                ? `Chat with yourself${metaTitlePostfix}`
                : `Chat with ${joinPrettyConjunctionList(
                      otherChatAccounts.map(account =>
                          getAccountShortNameWithoutFullNameTooltip(account),
                      ),
                  )}${metaTitlePostfix}`,
    };
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
