import {useEffect, useRef, useState} from "react";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {BotOwnerSelection} from "~/client/web/bots/bot_owner_selection.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    channelCreatorFieldHelpMarginTop,
    channelCreatorGap,
    channelCreatorMarginTop,
    channelCreatorNavigationBarDesktopTitleFontSize,
} from "~/client/web/styles/forum_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {
    botOwnerEntityIdForAccount,
    botOwnerEntityIdForSpace,
} from "~/shared/bots/owners/bot_owner_entity.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {createBot} from "~/shared/rpc/bots_rpc_definitions.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Route-based creator for a fully custom bot. Modeled on the chat room creation
 * flow (`RoomChatCreator`): owns its surface via the navigation bar and opens in a
 * peek. Picks a name, decides whether to share the bot with the rest of the space,
 * then creates it.
 */
export function CreateBotView() {
    const navigate = useRootNavigate();
    const context = useAppContext();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();
    const currentAccountData = useAccountModel(currentAccount);
    const canManageSpaceBots = hasSpaceRole(currentAccountData.space.role, "Admin");

    const containerRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const createButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [name, setName] = useState("");
    const [botOwnerType, setBotOwnerType] = useState<"Personal" | "Shared">("Personal");

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const nameInputElement = assertExists(nameInputRef.current);

        return scheduleAfterNavigationAnimation(() => {
            nameInputElement.focus();
        });
    }, []);

    const isCreateDisabled = name.trim().length === 0;

    const handleCreate = async () => {
        const {botId} = await createBot(context, {
            name: name.trim(),
            ownerEntity:
                botOwnerType === "Shared"
                    ? botOwnerEntityIdForSpace(space.id)
                    : botOwnerEntityIdForAccount(currentAccount.id),
            webhook: null,
            spaceId: space.id,
        });
        await navigate(`/settings/${space.id}/bots/${botId}`);
    };

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: "Create a bot",
        withoutDisappearingTitle: true,
        desktopTitleFontSize: channelCreatorNavigationBarDesktopTitleFontSize,
        desktopTitleFontWeight: "bold",
        replaceActions: (
            <Box
                display="flex"
                justifyContent="flex-end"
                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
            >
                <Button
                    ref={createButtonRef}
                    variant="neutral"
                    fontSize="100"
                    isDisabled={isCreateDisabled}
                    pressErrorTitle="Couldn&#x2019;t create bot"
                    onPress={handleCreate}
                >
                    Create
                </Button>
            </Box>
        ),
        defaultPreviousRoute: `/settings/${space.id}/bots`,
    });

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                containerRef,
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            overflowY="auto"
        >
            <OverlayScopeContextProvider>
                <Box
                    position="relative"
                    paddingY="safe-area-inset"
                    width="full"
                    maxWidth={peekNarrowLayoutWidth}
                    marginX="auto"
                >
                    {navigationBar}
                    <Box height={navigationBarHeight} />
                    <Box
                        display="flex"
                        flexDirection="column"
                        gap={channelCreatorGap}
                        paddingTop={channelCreatorMarginTop}
                        paddingBottom="24"
                        paddingX={screenPaddingX}
                    >
                        <Box>
                            <TextInput
                                ref={nameInputRef}
                                fontSize="100"
                                label="Name"
                                placeholder="e.g. Standup Buddy"
                                value={name}
                                onChange={setName}
                                onEnter={() => assertExists(createButtonRef.current).press()}
                            />
                            <Box
                                paddingTop={channelCreatorFieldHelpMarginTop}
                                fontSize="75"
                                color="grey-60"
                                userSelect="text"
                            >
                                Build your own custom bot that can make requests to the Alpine API
                                and receive events via webhook.
                            </Box>
                        </Box>
                        {canManageSpaceBots && (
                            <BotOwnerSelection
                                spaceName={space.name}
                                botOwnerType={botOwnerType}
                                onChange={setBotOwnerType}
                            />
                        )}
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}
