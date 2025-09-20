import {Ref, forwardRef, useCallback, useMemo, useRef} from "react";
import {chatMessagingViewHeaderItem} from "~/client/chat/internal/chat_messaging_view_header_item.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {MessagingView, MessagingViewRef} from "~/client/messaging/messaging_view.js";
import {useWebSocket} from "~/client/web_socket/use_web_socket.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
} from "~/shared/rpc/chat_rpc_definitions.js";

const NewChatMessagingViewForwardRef = forwardRef(NewChatMessagingView);
export {NewChatMessagingViewForwardRef as NewChatMessagingView};

function NewChatMessagingView(
    {
        selectedChat,
    }: {
        selectedChat: {
            chat: ChatModel;
            initialMessages: ReadonlyArray<ChatMessageModel>;
            initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
        } | null;
    },
    ref: Ref<MessagingViewRef>,
) {
    const context = useAppContext();

    const {isConnected, procedures, subscribeToEvents} = useWebSocket(
        "ChatRealtimeService",
        ChatRealtimeProtocol,
        selectedChat ? `/api/durable-objects/chat/${selectedChat.chat.id}` : null,
    );

    // This ref is used to preserve the message input state across React key
    // changes. `<MessageInput>` will write state changes to the ref and initialize
    // its state from the ref on remount.
    const inputRestoreStateRef = useRef(null);

    const fileAttachmentTarget = useMemo((): FileAttachmentTarget | null => {
        if (!selectedChat) return null;
        return {type: "ChatMessages", chatId: selectedChat.chat.id};
    }, [selectedChat]);

    return (
        <MessagingView
            ref={ref}
            key={selectedChat?.chat.id ?? "unknown"}
            initialScrollOffset="bottom"
            initialMessagesResult={
                selectedChat
                    ? {
                          messageCount: selectedChat.chat.messageCount,
                          messages: selectedChat.initialMessages,
                          otherReferencedMessages: selectedChat.initialOtherReferencedMessages,
                          lastMessageChangeTime: selectedChat.chat.lastMessageChangeTime,
                      }
                    : {
                          messageCount: 0,
                          messages: [],
                          otherReferencedMessages: [],
                          lastMessageChangeTime: null,
                      }
            }
            header={chatMessagingViewHeaderItem}
            randomSeedForShimmer={selectedChat?.chat.id ?? "unknown"}
            isMessageCreationDisabled={!selectedChat}
            fileAttachmentTarget={fileAttachmentTarget}
            // Since `selectedChat` may change we want to attach files right before the
            // message is created instead of when files are added to the message input.
            withAttachFileBeforeCreateMessage={true}
            getMessagesFromStart={useEvent(input => {
                if (!selectedChat) {
                    throw new InternalError("Can not load messages when we don’t know the chat");
                }
                return getChatMessagesFromStart(context, {...input, chatId: selectedChat.chat.id});
            })}
            getMessagesFromEnd={useEvent(input => {
                if (!selectedChat) {
                    throw new InternalError("Can not load messages when we don’t know the chat");
                }
                return getChatMessagesFromEnd(context, {...input, chatId: selectedChat.chat.id});
            })}
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now. Only errs when Bazel runs TypeScript which is strange.
            // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            backfillMessages={procedures.backfillMessages}
            createMessage={procedures.createMessage}
            updateMessageContent={procedures.updateMessageContent}
            deleteMessage={procedures.deleteMessage}
            startTypingInMessageInput={useCallback(
                async input => {
                    // May be called when we don't have a selected chat.
                    if (!selectedChat) return {};

                    return procedures.startTypingInMessageInput(input);
                },
                [procedures, selectedChat],
            )}
            stopTypingInMessageInput={useCallback(
                async input => {
                    // May be called when we don't have a selected chat.
                    if (!selectedChat) return {};

                    return procedures.stopTypingInMessageInput(input);
                },
                [procedures, selectedChat],
            )}
            isConnected={isConnected}
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now. Only errs when Bazel runs TypeScript which is strange.
            // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            subscribeToEvents={subscribeToEvents}
            getMessageUrl={useCallback(
                messageIndex => {
                    // This should never throw through (mostly) coincidence. The only messages you
                    // should see when we don't know the chat are optimistic messages. You can not
                    // copy the link of an optimistic message because we don't know the index. We
                    // get the index when we connect to realtime when we discover the chat ID.
                    // Therefore to have a message index we need a chat.
                    if (!selectedChat) {
                        throw new InternalError(
                            "Should not be able to copy link of chat message when we don’t know the chat",
                        );
                    }
                    return new URL(
                        `/s/${selectedChat.chat.spaceId}/chat/${selectedChat.chat.id}?message=${messageIndex}`,
                        window.location.href,
                    );
                },
                [selectedChat],
            )}
            inputRestoreStateRef={inputRestoreStateRef}
        />
    );
}
