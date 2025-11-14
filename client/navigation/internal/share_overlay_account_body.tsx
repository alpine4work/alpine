import {useRef, useState} from "react";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
import {ContentEditor} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {Checkbox} from "~/client/design/checkbox.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {PrettyNumber} from "~/client/design/pretty_number.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {getClientInfo} from "~/client/remix/client_info_context.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {messageInputEditorPaddingYPx} from "~/client/styles/messaging_shared_styles.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {trimContent} from "~/shared/content/trim_content.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {markSearchAffinityEntityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareOverlayAccountBody({
    selectedAccounts,
    willAlwaysNotifyPeople = false,
    onShare,
}: {
    selectedAccounts: ReadonlyArray<AccountModel>;
    willAlwaysNotifyPeople?: boolean;
    onShare: (notification: ShareNotification | null) => MaybePromise<void>;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {space} = useSpaceContext();

    const buttonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{willNotifyPeople, messageState}, setState] = useState<{
        willNotifyPeople: boolean;
        messageState: ContentEditorState<MessageContentWithReferences>;
    }>(() => ({
        willNotifyPeople: true,
        messageState: ContentEditorState.create(emptyMessageContentWithReferences),
    }));

    if (!willNotifyPeople && willAlwaysNotifyPeople) {
        setState({willNotifyPeople: true, messageState});
    }

    // Only allow three lines of text in the message before we start scrolling.
    const messageMinHeightPx =
        contentStyles.paragraphLineHeightPx[spacingScale] * 4 +
        messageInputEditorPaddingYPx[platform][spacingScale] * 2;

    const messageMaxHeightPx =
        contentStyles.paragraphLineHeightPx[spacingScale] *
            // Less max height on mobile since there's less vertical screen space and we
            // don't let the outer view scroll. Only the inner view.
            (platform === "mobile" ? 7 : 10) +
        messageInputEditorPaddingYPx[platform][spacingScale] * 2;

    return (
        <>
            {!willAlwaysNotifyPeople && (
                <>
                    <Spacer space="3" />
                    <Box
                        display="flex"
                        justifyContent="space-between"
                        alignItems="center"
                        height="7"
                    >
                        <Checkbox
                            color="grey-70"
                            isChecked={willNotifyPeople}
                            onChange={willNotifyPeople => {
                                setState(state => ({
                                    willNotifyPeople,
                                    // Keep the content but reset the selection when `willNotifyPeople` changes.
                                    messageState: ContentEditorState.create(
                                        state.messageState.getContent(),
                                    ),
                                }));
                            }}
                        >
                            Notify{" "}
                            {selectedAccounts.length === 0 ? (
                                "people"
                            ) : selectedAccounts.length === 1 ? (
                                <AccountShortName
                                    isTooltipDisabled
                                    account={selectedAccounts[0]!}
                                />
                            ) : selectedAccounts.length === 2 ? (
                                <>
                                    <AccountShortName
                                        isTooltipDisabled
                                        account={selectedAccounts[0]!}
                                    />{" "}
                                    and{" "}
                                    <AccountShortName
                                        isTooltipDisabled
                                        account={selectedAccounts[1]!}
                                    />
                                </>
                            ) : (
                                <>
                                    <AccountShortName
                                        isTooltipDisabled
                                        account={selectedAccounts[0]!}
                                    />
                                    ,{" "}
                                    <AccountShortName
                                        isTooltipDisabled
                                        account={selectedAccounts[1]!}
                                    />
                                    , and{" "}
                                    <PrettyNumber
                                        number={selectedAccounts.length - 2}
                                        label="other"
                                    />
                                </>
                            )}
                        </Checkbox>
                        {!willNotifyPeople && (
                            <Button
                                ref={buttonRef}
                                height="7"
                                variant="neutral"
                                isDisabled={selectedAccounts.length === 0}
                                pressErrorTitle="Couldn’t share"
                                onPress={async () => {
                                    await onShare(
                                        willNotifyPeople
                                            ? {
                                                  accountIds: selectedAccounts.map(({id}) => id),
                                                  content: trimContent(messageState.getDoc()),
                                                  createdTimeZone: getClientInfo().timeZone,
                                              }
                                            : null,
                                    );

                                    // Increase affinity points for all accounts this actor granted access to with
                                    // a high intent update since the user clearly wants to show something to the
                                    // granted accounts.
                                    for (const account of selectedAccounts) {
                                        void markSearchAffinityEntityInteraction(context, {
                                            spaceId: space.id,
                                            entityId: `Account:${account.id}`,
                                            interaction: {type: "HighIntentUpdate"},
                                        });
                                    }
                                }}
                            >
                                Share
                            </Button>
                        )}
                    </Box>
                </>
            )}
            <Box display={willNotifyPeople ? "block" : "none"}>
                <Spacer space="1" />
                <FocusRing offset="border" isVisibleWhenFocusWithin>
                    <Box
                        position="relative"
                        zIndex="0"
                        borderRadius="1.5"
                        style={{
                            minHeight: messageMinHeightPx,
                            maxHeight: messageMaxHeightPx,
                        }}
                    >
                        <Box
                            position="absolute"
                            inset="0"
                            pointerEvents="none"
                            zIndex="10"
                            borderRadius="1.5"
                            style={{
                                // Use `box-shadow` instead of `border` so drawing the border doesn't take
                                // space in the layout.
                                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                            }}
                        />
                        <Box
                            ref={useScrollbar()}
                            position="relative"
                            zIndex="0"
                            borderRadius="1.5"
                            overflowY="auto"
                            style={{
                                minHeight: messageMinHeightPx,
                                maxHeight: messageMaxHeightPx,
                            }}
                        >
                            <Box
                                display="flex"
                                flexDirection="column"
                                style={{minHeight: messageMinHeightPx}}
                            >
                                <ContentEditor
                                    aria-label="Message"
                                    placeholder="Add a message (optional)"
                                    state={messageState}
                                    onChange={messageState => {
                                        if (!willNotifyPeople) return;
                                        setState(state => ({...state, messageState}));
                                    }}
                                    containerClassName={sprinkles({flexGrow: "1"})}
                                    style={{
                                        paddingTop:
                                            messageInputEditorPaddingYPx[platform][spacingScale],
                                        paddingBottom:
                                            messageInputEditorPaddingYPx[platform][spacingScale],
                                        paddingLeft: spacing["3"],
                                        paddingRight: spacing["3"],
                                        borderRadius: spacing["1.5"],
                                    }}
                                    onModEnterKeyDown={() => {
                                        assertExists(buttonRef.current).press();
                                    }}
                                    // Always in editing mode. User won't be reading while in the modal.
                                    withoutMobileDualModality={true}
                                />
                            </Box>
                        </Box>
                    </Box>
                </FocusRing>
            </Box>
            {(willAlwaysNotifyPeople || willNotifyPeople) && (
                <>
                    <Spacer space="3" />
                    <Box display="flex" justifyContent="flex-end" alignItems="center">
                        <Button
                            ref={buttonRef}
                            fullWidth={willAlwaysNotifyPeople}
                            height={willAlwaysNotifyPeople ? "8" : "7"}
                            borderRadius={willAlwaysNotifyPeople ? "1.5" : undefined}
                            variant="neutral"
                            isDisabled={selectedAccounts.length === 0}
                            pressErrorTitle="Couldn’t share"
                            onPress={async () => {
                                await onShare(
                                    willNotifyPeople
                                        ? {
                                              accountIds: selectedAccounts.map(({id}) => id),
                                              content: trimContent(messageState.getDoc()),
                                              createdTimeZone: getClientInfo().timeZone,
                                          }
                                        : null,
                                );

                                // Increase affinity points for all accounts this actor granted access to with
                                // a high intent update since the user clearly wants to show something to the
                                // granted accounts.
                                for (const account of selectedAccounts) {
                                    void markSearchAffinityEntityInteraction(context, {
                                        spaceId: space.id,
                                        entityId: `Account:${account.id}`,
                                        interaction: {type: "HighIntentUpdate"},
                                    });
                                }
                            }}
                        >
                            Share
                        </Button>
                    </Box>
                </>
            )}
        </>
    );
}
