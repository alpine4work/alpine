import {Dispatch, SetStateAction, useRef, useState} from "react";
import {usePress} from "react-aria";
import {ContentEditor} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {Checkbox} from "~/client/design/checkbox.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {messageInputEditorPaddingYPx} from "~/client/styles/messaging_shared_styles.js";
import {colorSchemeVars, contentStyles, sprinkles} from "~/client/styles/styles.js";
import {AccessLevel, AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {markSearchAffinityEntityInteraction} from "~/shared/rpc/search_rpc_definitions.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export function ShareOverlayAccountGrantBody({
    selectedAccounts,
    onSelectedAccountsChange,
    accessLevel,
    onAccessPolicyChange,
}: {
    selectedAccounts: ReadonlyArray<AccountModel>;
    onSelectedAccountsChange: Dispatch<SetStateAction<ReadonlyArray<AccountModel>>>;
    accessLevel: AccessLevel;
    onAccessPolicyChange: (
        accessPolicy: AccessPolicyAction,
        notification: ShareNotification | null,
    ) => MaybePromise<void>;
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

    const {isPressed: isNotifyPeoplePressed, pressProps: notifyPeoplePressProps} = usePress({
        onPress: () => {
            setState(state => ({
                willNotifyPeople: !state.willNotifyPeople,
                // Keep the content but reset the selection when `willNotifyPeople` changes.
                messageState: ContentEditorState.create(state.messageState.getContent()),
            }));
        },
    });

    // Only allow three lines of text in the message before we start scrolling.
    const messageMinHeightPx =
        contentStyles.paragraphLineHeightPx[spacingScale] * 4 +
        messageInputEditorPaddingYPx[platform][spacingScale] * 2;

    const messageMaxHeightPx =
        contentStyles.paragraphLineHeightPx[spacingScale] * 10 +
        messageInputEditorPaddingYPx[platform][spacingScale] * 2;

    return (
        <Box paddingX="5">
            <Box display={willNotifyPeople ? "block" : "none"}>
                <Spacer space="5" />
                <FocusRing offset="border" isVisibleWhenFocusWithin>
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
                            />
                        </Box>
                    </Box>
                </FocusRing>
            </Box>
            <Spacer space="5" />
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Box
                    {...notifyPeoplePressProps}
                    color="grey-60"
                    // Enough touch slop space (see `use_touch_slop.ts`)
                    height="6"
                    display="flex"
                    alignItems="center"
                    gap="1.5"
                >
                    <Checkbox isChecked={willNotifyPeople} isPressed={isNotifyPeoplePressed} />
                    <Box
                        position="relative"
                        style={{
                            // Optically align text with checkbox.
                            top: `${0.5 / remPxBySpacingScale.medium}rem`,
                        }}
                    >
                        Notify people
                    </Box>
                </Box>
                <Button
                    ref={buttonRef}
                    variant="neutral"
                    isDisabled={selectedAccounts.length === 0}
                    pressErrorTitle="Couldn’t share"
                    onPress={async () => {
                        const newAccountGrantById = new Map<
                            AccountId,
                            DistributiveOmit<AccessPolicyAccountGrant, "generation">
                        >();

                        for (const selectedAccount of selectedAccounts) {
                            if (!newAccountGrantById.has(selectedAccount.id)) {
                                newAccountGrantById.set(selectedAccount.id, {
                                    level: accessLevel,
                                });
                            }
                        }

                        await onAccessPolicyChange(
                            {
                                type: "AddAccountGrants",
                                accountGrantById: newAccountGrantById,
                            },
                            // NOCOMMIT: Integration test that notification actually gets sent
                            willNotifyPeople
                                ? {
                                      accountIds: Array.from(newAccountGrantById.keys()),
                                      content: messageState.getDoc(),
                                  }
                                : null,
                        );

                        onSelectedAccountsChange(emptyArray);

                        // Increase affinity points for all accounts this actor granted access to with
                        // a high intent update since the user clearly wants to show something to the
                        // granted accounts.
                        for (const accountId of newAccountGrantById.keys()) {
                            void markSearchAffinityEntityInteraction(context, {
                                spaceId: space.id,
                                entityId: `Account:${accountId}`,
                                interaction: {type: "HighIntentUpdate"},
                            });
                        }
                    }}
                >
                    Share
                </Button>
            </Box>
        </Box>
    );
}
