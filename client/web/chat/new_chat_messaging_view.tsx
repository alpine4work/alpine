import {Memo, Ref, forwardRef, useCallback, useEffect, useMemo, useRef} from "react";
import {getSafeCurrentlyViewedEntityIfPossibleForClient} from "~/client/web/bots/get_safe_current_viewed_entity_if_possible_for_client.js";
import {ChatDirectOneOnOneInvitePendingOverlayController} from "~/client/web/chat/internal/chat_direct_one_on_one_invite_pending_overlay_controller.js";
import {chatMessagingViewHeaderItem} from "~/client/web/chat/internal/chat_messaging_view_header_item.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {MessagingView, MessagingViewRef} from "~/client/web/messaging/messaging_view.js";
import {useCurrentlyViewingSearchEntityId} from "~/client/web/remix/use_currently_viewing_search_entity_id.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {useWebSocket} from "~/client/web/web_socket/use_web_socket.js";
import {ChatMessageModel, ChatModel} from "~/shared/chat/chat_model.js";
import {ChatRealtimeProtocol} from "~/shared/chat/chat_realtime_protocol.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";
import {MessageDraftWithFiles} from "~/shared/messaging/message_draft_schema.js";
import {MessagingRealtimeEvent} from "~/shared/messaging/messaging_realtime_protocol.js";
import {
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    getChatWithStrongReadConsistency,
} from "~/shared/rpc/chat_rpc_definitions.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

const NewChatMessagingViewForwardRef = forwardRef(NewChatMessagingView);
export {NewChatMessagingViewForwardRef as NewChatMessagingView};

function NewChatMessagingView(
    {
        initialCheckpoint,
        selectedChat,
        messageDraft,
        onUpdateSelectedChat,
    }: {
        initialCheckpoint: ServerSynchronizationCheckpoint;
        selectedChat: {
            chat: ChatModel;
            initialMessages: ReadonlyArray<ChatMessageModel>;
            initialOtherReferencedMessages: ReadonlyArray<ChatMessageModel>;
        } | null;
        messageDraft: MessageDraftWithFiles;
        onUpdateSelectedChat: Memo<(chat: ChatModel) => void>;
    },
    ref: Ref<MessagingViewRef<ChatId>>,
) {
    const context = useAppContext();
    const spaceContext = useSpaceContext();
    let currentlyViewingSearchEntityId = useCurrentlyViewingSearchEntityId();

    // We only send the currently viewed entity for 1:1 chats with a bot. We do some
    // validation here and on the server.
    currentlyViewingSearchEntityId = getSafeCurrentlyViewedEntityIfPossibleForClient(
        spaceContext,
        selectedChat?.chat,
        currentlyViewingSearchEntityId,
    );

    const {isConnected, procedures, subscribeToEvents, subscribeToPongs} = useWebSocket(
        "ChatRealtimeService",
        ChatRealtimeProtocol,
        selectedChat ? `/api/durable-objects/chat/${selectedChat.chat.id}` : null,
    );

    const selectedChatId = selectedChat?.chat.id;
    const lastBackfilledChatIdRef = useRef<ChatId | null>(null);

    useEffect(() => {
        if (!isConnected || !selectedChatId) {
            // Clear so on reconnection we'll backfill the chat again.
            lastBackfilledChatIdRef.current = null;
            return;
        }

        // Backfill the chat once realtime is connected. When we've connected to realtime
        // we'll get all events from the time `isConnected` is true on but we'll have
        // missed any events from when we weren't connected to the WebSocket.
        if (lastBackfilledChatIdRef.current !== selectedChatId) {
            lastBackfilledChatIdRef.current = selectedChatId;

            getChatWithStrongReadConsistency(context, {chatId: selectedChatId}).then(
                ({chat}) => onUpdateSelectedChat(chat),
                error => {
                    context.tracer.getRoot().logException("Failed to backfill chat", error);
                },
            );
        }

        return subscribeToEvents(event => {
            if (event.type === "UpdateChat") {
                onUpdateSelectedChat(event.chat);
            }
        });
    }, [context, isConnected, onUpdateSelectedChat, selectedChatId, subscribeToEvents]);

    // This ref is used to preserve the message input state across React key changes.
    // `<MessageInput>` will write state changes to the ref and initialize its state
    // from the ref on remount.
    const inputRestoreStateRef = useRef(null);

    const fileAttachmentTarget = useMemo((): FileAttachmentTarget | null => {
        if (!selectedChat) return null;
        return {type: "ChatMessages", chatId: selectedChat.chat.id};
    }, [selectedChat]);

    const draftSurface = useMemo(() => {
        if (!selectedChat) return undefined;
        return {type: "Chat" as const, chatId: selectedChat.chat.id};
    }, [selectedChat]);

    return (
        <MessagingView
            ref={ref}
            key={selectedChat?.chat.id ?? "unknown"}
            initialScrollOffset="bottom"
            initialMessagesResult={
                selectedChat
                    ? {
                          checkpoint: initialCheckpoint,
                          messageCount: selectedChat.chat.messageCount,
                          messages: selectedChat.initialMessages,
                          otherReferencedMessages: selectedChat.initialOtherReferencedMessages,
                      }
                    : {
                          checkpoint: initialCheckpoint,
                          messageCount: 0,
                          messages: [],
                          otherReferencedMessages: [],
                      }
            }
            header={chatMessagingViewHeaderItem}
            randomSeedForShimmer={selectedChat?.chat.id ?? "unknown"}
            isMessageCreationDisabled={!selectedChat}
            fileAttachmentTarget={fileAttachmentTarget}
            // Since `selectedChat` may change we want to attach files right before the message
            // is created instead of when files are added to the message input.
            withAttachFileBeforeCreateMessage={true}
            getMessagesFromStart={useEvent(input => {
                if (!selectedChat) {
                    throw new InternalError(
                        "Can not load messages when we don\u2019t know the chat",
                    );
                }
                return getChatMessagesFromStart(context, {...input, chatId: selectedChat.chat.id});
            })}
            getMessagesFromEnd={useEvent(input => {
                if (!selectedChat) {
                    throw new InternalError(
                        "Can not load messages when we don\u2019t know the chat",
                    );
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
            setMessageReaction={procedures.setMessageReaction}
            deleteMessageReaction={procedures.deleteMessageReaction}
            putMessageApprovalDecisions={procedures.putMessageApprovalDecisions}
            approvalSessionNoun="chat"
            messageDraftSurface={draftSurface}
            messageDraft={messageDraft}
            startTypingInMessageInput={useCallback(
                async input => {
                    // May be called when we don't have a selected chat.
                    if (!selectedChat) return {};

                    return await procedures.startTypingInMessageInput(input);
                },
                [procedures, selectedChat],
            )}
            stopTypingInMessageInput={useCallback(
                async input => {
                    // May be called when we don't have a selected chat.
                    if (!selectedChat) return {};

                    return await procedures.stopTypingInMessageInput(input);
                },
                [procedures, selectedChat],
            )}
            isConnected={isConnected}
            // There's a strange TypeScript error here that only shows up when Bazel runs
            // TypeScript where it thinks the type of `subscribeToEvents` should include
            // `{ [x: number]: never; }`. Not fixing for now, may be a TypeScript bug that
            // disappears on upgrade.
            // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            subscribeToEvents={useCallback(
                (subscriber: (event: MessagingRealtimeEvent<ChatMessageModel>) => void) => {
                    return subscribeToEvents(event => {
                        if (event.type !== "UpdateChat") {
                            subscriber(event);
                        }
                    });
                },
                [subscribeToEvents],
            )}
            subscribeToPongs={subscribeToPongs}
            getMessageUrl={useCallback(
                messageIndex => {
                    // This should never throw through (mostly) coincidence. The only messages you
                    // should see when we don't know the chat are optimistic messages. You can not copy
                    // the link of an optimistic message because we don't know the index. We get the
                    // index when we connect to realtime when we discover the chat ID. Therefore to
                    // have a message index we need a chat.
                    if (!selectedChat) {
                        throw new InternalError(
                            "Should not be able to copy link of chat message when we don\u2019t know the chat",
                        );
                    }
                    return new URL(
                        `/chat/${selectedChat.chat.id}?message=${messageIndex}`,
                        window.location.href,
                    );
                },
                [selectedChat],
            )}
            inputRestoreStateRef={inputRestoreStateRef}
            dangerousCurrentlyViewingSearchEntityId={currentlyViewingSearchEntityId}
            extraChildren={
                selectedChat && (
                    <ChatDirectOneOnOneInvitePendingOverlayController chat={selectedChat.chat} />
                )
            }
        />
    );
}
