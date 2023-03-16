import {useCallback, useState} from "react";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker";
import {Box} from "~/client/design/box";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {MessagingView} from "~/client/messaging/messaging_view";
import {UnimplementedError} from "~/shared/error/error";
import {ChatId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";

export function ChatRoute() {
    const [selectedAccounts, setSelectedAccounts] = useState<ReadonlyArray<AccountModel>>([]);

    // TODO(calebmer): Get rid of this!
    const unknownChatId = useConstant(() => "gd38c974yx0xszfatef0b60tac" as ChatId);

    return (
        <Box
            flexGrow="1"
            width="full"
            overflow="hidden"
            padding={{desktop: "4"}}
            display="flex"
            justifyContent="center"
        >
            <Box
                maxWidth="160"
                width="full"
                height="full"
                backgroundColor="grey-0"
                borderRadius={{desktop: "md"}}
                boxShadow="elevation-5"
                display="flex"
                flexDirection="column"
            >
                <Box flexShrink="0" borderBottom="grey-10">
                    <ChatAccountPicker
                        selectedAccounts={selectedAccounts}
                        setSelectedAccounts={setSelectedAccounts}
                    />
                </Box>
                <MessagingView
                    roomKey={unknownChatId}
                    initialScrollOffset="bottom"
                    initialMessagesResult={{
                        messageCount: 0,
                        messages: [],
                        otherReferencedMessages: [],
                        lastMessageChangeTime: null,
                    }}
                    getMessagesFromStart={useCallback(() => {
                        throw new UnimplementedError("TODO");
                    }, [])}
                    getMessagesFromEnd={useCallback(() => {
                        throw new UnimplementedError("TODO");
                    }, [])}
                    createMessage={useCallback(() => {
                        throw new UnimplementedError("TODO");
                    }, [])}
                    updateMessageContent={useCallback(() => {
                        throw new UnimplementedError("TODO");
                    }, [])}
                    deleteMessage={useCallback(() => {
                        throw new UnimplementedError("TODO");
                    }, [])}
                    getCopyLinkUrl={useCallback(() => {
                        throw new UnimplementedError("TODO");
                    }, [])}
                />
            </Box>
        </Box>
    );
}
