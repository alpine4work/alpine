import {IconContext} from "phosphor-react";
import {Memo, ReactElement, ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {useReporter} from "~/client/design/reporter.js";
import {useStateWithOptimisticUpdates} from "~/client/helpers/use_state_with_optimistic_updates.js";
import {
    OnDeleteMessageReactionFunction,
    OnSetMessageReactionFunction,
    OnUpdateMessagesOptimisticallyFunction,
    deleteMessageReactionWithOptimisticUpdate,
    setMessageReactionWithOptimisticUpdate,
} from "~/client/messaging/set_or_delete_message_reaction_with_optimistic_update.js";
import {
    CurrentAccountReactionButtonIcon,
    ReactionButtonBase,
} from "~/client/reactions/reaction_button.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

export function MessageViewContextMenuReactionButton<
    RoomKey extends string,
    Message extends MessageModel<RoomKey>,
>({
    isPressed,
    renderStructure,
    messageNoun,
    roomKey,
    messageIndex,
    contentVersion,
    pos,
    reactions: initialReactions,
    onSetMessageReaction,
    onDeleteMessageReaction,
    onUpdateMessagesOptimistically,
}: {
    isPressed: boolean;
    renderStructure: ({
        isPressed,
        children,
    }: {
        isPressed?: boolean;
        children: ReactNode;
    }) => ReactElement;
    messageNoun: string;
    roomKey: RoomKey;
    messageIndex: number;
    contentVersion: number;
    pos: number;
    reactions: ReactionSet;
    onSetMessageReaction: Memo<OnSetMessageReactionFunction<RoomKey>>;
    onDeleteMessageReaction: Memo<OnDeleteMessageReactionFunction<RoomKey>>;
    onUpdateMessagesOptimistically: Memo<OnUpdateMessagesOptimisticallyFunction<RoomKey, Message>>;
}) {
    const reporter = useReporter();
    const {currentAccount} = useSpaceContextAndRequireSpaceAccess();

    // The way context menu is built this component doesn't re-render when
    // `reactions` changes. Since we create the component once when the context
    // menu is created and it's rendered at the root of app. Not as a child of
    // `<MessageView>`. So we don't see new `reactions`.
    //
    // But we still want to update the reaction in the right-click menu. So we
    // have our own `ReactionSet` state object here we'll update when the user
    // picks a reaction. This won't see changes made in realtime but that's an
    // acceptable tradeoff for us in the context menu.
    const [reactions, , setReactionsOptimistically] =
        useStateWithOptimisticUpdates(initialReactions);

    return (
        <ReactionButtonBase
            withoutButtonElementRequirement={true}
            reactions={reactions}
            onSetReaction={reaction => {
                setMessageReactionWithOptimisticUpdate({
                    reporter,
                    currentAccountId: currentAccount.id,
                    messageNoun,
                    roomKey,
                    messageIndex,
                    contentVersion,
                    pos,
                    reaction,
                    onUpdateMessagesOptimistically,
                    onSetMessageReaction: (roomKey, input) => {
                        const promise = onSetMessageReaction(roomKey, input);

                        setReactionsOptimistically(promise, oldReactions => {
                            const newReactions = new Map(oldReactions.get());
                            newReactions.set(currentAccount.id, input.reaction);
                            return new ReactionSet(newReactions);
                        });

                        return promise;
                    },
                });
            }}
            onDeleteReaction={() => {
                deleteMessageReactionWithOptimisticUpdate({
                    reporter,
                    currentAccountId: currentAccount.id,
                    messageNoun,
                    roomKey,
                    messageIndex,
                    contentVersion,
                    pos,
                    onUpdateMessagesOptimistically,
                    onDeleteMessageReaction: (roomKey, input) => {
                        const promise = onDeleteMessageReaction(roomKey, input);

                        setReactionsOptimistically(promise, oldReactions => {
                            const newReactions = new Map(oldReactions.get());
                            newReactions.delete(currentAccount.id);
                            return new ReactionSet(newReactions);
                        });

                        return promise;
                    },
                });
            }}
        >
            {({currentAccountReaction, isMouseDownFromOverlayOpen}) =>
                renderStructure({
                    isPressed: isMouseDownFromOverlayOpen,
                    children: (
                        <Box
                            display="flex"
                            alignItems="center"
                            gap="2"
                            paddingLeft="2"
                            paddingRight="1.5"
                            paddingY="1.5"
                        >
                            <Box flexGrow="1" fontSize="75" fontStyle="truncate">
                                Add reaction
                            </Box>
                            <Box flexShrink="0" minWidth="4" minHeight="4">
                                <IconContext.Provider
                                    value={{
                                        color: isPressed
                                            ? colorSchemeVars["grey-100"]
                                            : colorSchemeVars["grey-80"],
                                        size: spacing["4"],
                                        weight: "regular",
                                    }}
                                >
                                    <CurrentAccountReactionButtonIcon
                                        currentAccountReaction={currentAccountReaction}
                                        isPressed={isMouseDownFromOverlayOpen}
                                    />
                                </IconContext.Provider>
                            </Box>
                        </Box>
                    ),
                })
            }
        </ReactionButtonBase>
    );
}
