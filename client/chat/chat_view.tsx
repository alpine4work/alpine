/* eslint-disable @typescript-eslint/no-misused-promises */

import {useCallback, useMemo, useState} from "react";
import {ChatAccountPicker} from "~/client/chat/chat_account_picker";
import {ChatViewHeader, chatViewHeaderHeight} from "~/client/chat/chat_view_header";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {MessagingView} from "~/client/messaging/messaging_view";
import {useSpaceContext} from "~/client/spaces/space_context";
import {VirtualizedScrollViewItem} from "~/client/virtualized/virtualized_scroll_view";
import {UnimplementedError} from "~/shared/error/error";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {AccountId, ChatId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {
    deleteChatMessage,
    getChatMessagesFromEnd,
    getChatMessagesFromStart,
    sendChatMessage,
    updateChatMessageContent,
} from "~/shared/rpc/chat_rpc_definitions";

export function ChatView() {
    const context = useAppContext();
    const {currentAccount} = useSpaceContext();
    const [selectedAccounts, setSelectedAccounts] = useState<ReadonlyArray<AccountModel>>([]);

    // The list of accounts we're chatting with. Includes our current user, doesn't
    // have duplicates, and is sorted deterministically by account ID.
    //
    // We use a similar variable name `allSortedAccountIds` on the server.
    const allSortedAccounts = useMemo(() => {
        const allSortedAccounts = new Map<AccountId, AccountModel>();
        allSortedAccounts.set(currentAccount.id, currentAccount);
        for (const account of selectedAccounts) allSortedAccounts.set(account.id, account);
        return Array.from(allSortedAccounts.values()).sort((a, b) =>
            defaultCompareStrings(a.id, b.id),
        );
    }, [currentAccount, selectedAccounts]);

    const messagingHeader = useMemo(
        (): DistributiveOmit<VirtualizedScrollViewItem, "key"> => ({
            minHeight: chatViewHeaderHeight,
            withManualLayout: true,
            render: ({
                ref,
                shouldRenderWithRelativePositioning,
                offset,
                height,
                itemCount,
                viewHeight,
                originalContentHeight,
            }) => (
                <div
                    ref={ref}
                    style={{
                        minHeight: chatViewHeaderHeight,
                        ...(shouldRenderWithRelativePositioning
                            ? {position: "relative"}
                            : {
                                  position: "absolute",
                                  top: offset,
                                  left: 0,
                                  right: 0,
                                  height: `max(${chatViewHeaderHeight}, ${
                                      viewHeight - (originalContentHeight - height)
                                  }px)`,
                              }),
                    }}
                >
                    {itemCount === 1 && <ChatViewHeader accounts={allSortedAccounts} />}
                </div>
            ),
        }),
        [allSortedAccounts],
    );

    return (
        <Box width="full" height="full" display="flex" flexDirection="column">
            <Box flexShrink="0" borderBottom="grey-10">
                <ChatAccountPicker
                    selectedAccounts={selectedAccounts}
                    setSelectedAccounts={setSelectedAccounts}
                />
            </Box>
            <MessagingView
                initialScrollOffset="bottom"
                initialMessagesResult={{
                    messageCount: 0,
                    messages: [],
                    otherReferencedMessages: [],
                    lastMessageChangeTime: null,
                }}
                header={messagingHeader}
                randomSeedForShimmer={useMemo(
                    () => allSortedAccounts.map(account => account.id).join("-"),
                    [allSortedAccounts],
                )}
                isMessageCreationDisabled={selectedAccounts.length === 0}
                getMessagesFromStart={useEvent(input => {
                    const chatId: ChatId = (() => {
                        throw new UnimplementedError("TODO");
                    })();
                    return getChatMessagesFromStart(context, {...input, chatId});
                })}
                getMessagesFromEnd={useEvent(input => {
                    const chatId: ChatId = (() => {
                        throw new UnimplementedError("TODO");
                    })();
                    return getChatMessagesFromEnd(context, {...input, chatId});
                })}
                createMessage={useEvent(async input => {
                    const chatId: ChatId = (() => {
                        throw new UnimplementedError("TODO");
                    })();
                    await sendChatMessage(context, {...input, chatId});
                })}
                updateMessageContent={useEvent(async input => {
                    const chatId: ChatId = (() => {
                        throw new UnimplementedError("TODO");
                    })();
                    await updateChatMessageContent(context, {...input, chatId});
                })}
                deleteMessage={useEvent(async input => {
                    const chatId: ChatId = (() => {
                        throw new UnimplementedError("TODO");
                    })();
                    await deleteChatMessage(context, {...input, chatId});
                })}
                getCopyLinkUrl={useCallback(() => {
                    throw new UnimplementedError("TODO");
                }, [])}
            />
        </Box>
    );
}
