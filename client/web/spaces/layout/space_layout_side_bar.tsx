import {ArrowLeft, ArrowRight, Gear, House, MagnifyingGlass, SignOut} from "phosphor-react";
import {ReactNode} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useNavigationState} from "~/client/web/navigation/navigation_state_context.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useNavigate, useRootNavigate} from "~/client/web/remix/use_navigate.js";
import {usePreloadSearchByAffinity} from "~/client/web/search/use_search_state.js";
import {SpaceLayoutSideBarCreateButton} from "~/client/web/spaces/layout/internal/space_layout_side_bar_create_button.js";
import {SpaceLayoutSideBarInboxButton} from "~/client/web/spaces/layout/internal/space_layout_side_bar_inbox_button.js";
import {SpaceLayoutSideBarSpaceButton} from "~/client/web/spaces/layout/internal/space_layout_side_bar_space_button.js";
import {useSpaceSideBarSpacing} from "~/client/web/spaces/route_metadata.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {spaceLayoutStyles} from "~/client/web/styles/styles.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceLayoutSideBar({
    space,
    currentAccount,
    initialInbox,
    onSearchPress,
}: {
    space: SpaceModel;
    currentAccount: AccountModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
    onSearchPress: () => void;
}) {
    const rootNavigate = useRootNavigate();
    const {isAppleDevice} = useClientInfo();

    // Preload affinitive search entities so they're ready when the search modal
    // opens. We expect search to be the primary way users navigate around the
    // product so the search modal should open immediately.
    usePreloadSearchByAffinity();

    const spaceSideBarSpacing = useSpaceSideBarSpacing();

    return (
        <Box
            zIndex="80"
            position="relative"
            flexShrink="0"
            style={{
                // Routes that take up the full screen width always allocate space for the
                // space layout sidebar instead of using dynamic space that attempts to
                // visually center content.
                width: {
                    Always: spaceLayoutStyles.sideBarWidth,
                    Never: 0,
                    Sometimes: spaceLayoutStyles.sideBarSpace,
                }[spaceSideBarSpacing],
            }}
        >
            <Box
                position="absolute"
                top="0"
                bottom="0"
                left="0"
                display="flex"
                flexDirection="column"
                alignItems="center"
                style={{width: spaceLayoutStyles.sideBarWidth}}
            >
                <Box
                    paddingTop="3"
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    gap="3"
                >
                    <SpaceLayoutSideBarSpaceButton space={space} />
                    <Box display="flex" flexDirection="column" alignItems="center" gap="2">
                        <IconButton
                            size="lg"
                            description="Home"
                            tooltipPlacement="right"
                            pressErrorTitle="Couldn’t open home"
                            onPress={async () => {
                                await rootNavigate(`/s/${space.id}`);
                            }}
                        >
                            <House />
                        </IconButton>
                        <IconButton
                            size="lg"
                            description="Search"
                            tooltipPlacement="right"
                            keyboardShortcutHint={isAppleDevice ? "⌘+P" : "Ctrl+P"}
                            onPress={onSearchPress}
                        >
                            <MagnifyingGlass />
                        </IconButton>
                        <SpaceLayoutSideBarInboxButton initialInbox={initialInbox} />
                        <SpaceLayoutSideBarCreateButton />
                    </Box>
                </Box>
                <Box flexGrow="1" />
                <Box
                    paddingBottom="3"
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    gap="3"
                >
                    <SpaceLayoutSideBarAccountButton currentAccount={currentAccount} />
                    <SpaceLayoutSideBarNavigationButtons />
                </Box>
            </Box>
        </Box>
    );
}

export function SpaceLayoutSideBarContentBlockWidthContextProvider({
    isDisabled,
    children,
}: {
    isDisabled: boolean;
    children: ReactNode;
}) {
    const spaceSideBarSpacing = useSpaceSideBarSpacing();

    return (
        <ContentBlockWidthContextProvider
            isDisabled={isDisabled}
            keepAssumedPadding={true}
            // TODO(calebmer): Should handle a `Sometimes` value for `spaceSideBarSpacing`.
            // Adding some padding left when the screen is small.
            paddingLeft={spaceSideBarSpacing === "Always" ? spaceLayoutStyles.sideBarWidth : 0}
        >
            {children}
        </ContentBlockWidthContextProvider>
    );
}

function SpaceLayoutSideBarNavigationButtons() {
    const navigate = useNavigate();
    const clientInfo = useClientInfo();
    const navigationState = useNavigationState();

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                // NOTE(calebmer): Overriding Cmd+[ or Cmd+] does nothing in Chrome since
                // browser level forward/backward shortcut can't be overridden. However,
                // Chrome's behavior is exactly what we want! This implementation is here for
                // other browsers or an eventual desktop app.
                if (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey) {
                    if (event.key === "[") {
                        event.preventDefault();
                        event.stopPropagation();

                        navigate(-1);
                    }

                    if (event.key === "]") {
                        event.preventDefault();
                        event.stopPropagation();

                        navigate(1);
                    }
                }
            }}
        >
            <Box flexShrink="0" display="flex" justifyContent="flex-start" alignItems="center">
                <IconButton
                    size="xs"
                    description="Go back"
                    keyboardShortcutHint={clientInfo.isAppleDevice ? "⌘+[" : "Ctrl+["}
                    tooltipPlacement="top"
                    isDisabled={!navigationState.hasPreviousLocation}
                    pressErrorTitle="Couldn’t go back"
                    onPress={() => navigate(-1)}
                >
                    <ArrowLeft />
                </IconButton>
                <IconButton
                    size="xs"
                    description="Go forwards"
                    keyboardShortcutHint={clientInfo.isAppleDevice ? "⌘+]" : "Ctrl+]"}
                    tooltipPlacement="top"
                    isDisabled={!navigationState.hasNextLocation}
                    pressErrorTitle="Couldn’t go forwards"
                    onPress={() => navigate(1)}
                >
                    <ArrowRight />
                </IconButton>
            </Box>
        </GlobalKeyDownEvent>
    );
}

function SpaceLayoutSideBarAccountButton({currentAccount}: {currentAccount: AccountModel}) {
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    return (
        <MenuButton
            placement="right-end"
            actions={[
                [
                    {
                        icon: <Gear />,
                        label: "Settings",
                        pressErrorTitle: "Couldn’t open settings",
                        onPress: () => rootNavigate(`/s/${space.id}/settings/profile`),
                    },
                ],
                [
                    {
                        icon: <SignOut />,
                        label: "Sign out",
                        pressErrorTitle: "Couldn’t sign out",
                        onPress: () => rootNavigate("/sign-out"),
                    },
                ],
            ]}
        >
            <IconButton
                size="lg"
                variant="image"
                description="Account"
                // The notification bell does not have a tooltip. It opens up an inbox preview
                // on hover. It's weird if the buttons around it have tooltips.
                withoutTooltip={true}
            >
                <AccountAvatar account={currentAccount} size="8" />
            </IconButton>
        </MenuButton>
    );
}
