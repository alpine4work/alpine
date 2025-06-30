import {Action} from "@remix-run/router";
import {ArrowLeft, ArrowRight, House, MagnifyingGlass, SignOut} from "phosphor-react";
import {useEffect, useState} from "react";
import {useLocation, useNavigationType} from "react-router";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {usePreloadSearchByAffinity} from "~/client/search/use_search_state.js";
import {SpaceLayoutSideBarCreateButton} from "~/client/spaces/layout/internal/space_layout_side_bar_create_button.js";
import {SpaceLayoutSideBarInboxButton} from "~/client/spaces/layout/internal/space_layout_side_bar_inbox_button.js";
import {SpaceLayoutSideBarSpaceButton} from "~/client/spaces/layout/internal/space_layout_side_bar_space_button.js";
import {useIsFullWidthRoute} from "~/client/spaces/route_metadata.js";
import {spaceLayoutStyles} from "~/client/styles/styles.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
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

    return (
        <Box
            zIndex="80"
            position="relative"
            flexShrink="0"
            style={{
                // Routes that take up the full screen width always allocate space for the
                // space layout sidebar instead of using dynamic space that attempts to
                // visually center content.
                width: useIsFullWidthRoute()
                    ? spaceLayoutStyles.sideBarWidth
                    : spaceLayoutStyles.sideBarSpace,
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
                            keyboardShortcutHint={isAppleDevice ? "⌘+K" : "Ctrl+K"}
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

const NavigationStateSchema = Schema.object({
    initialLocationKey: Schema.string,
    latestLocationKey: Schema.string,
    locationKey: Schema.string,
    hasNextLocation: Schema.boolean,
    hasPreviousLocation: Schema.boolean,
});

function SpaceLayoutSideBarNavigationButtons() {
    const location = useLocation();
    const navigationType = useNavigationType();
    const navigate = useNavigate();
    const clientInfo = useClientInfo();

    const [navigationState, setNavigationState] = useState<{
        initialLocationKey: string;
        latestLocationKey: string;
        locationKey: string;
        hasNextLocation: boolean;
        hasPreviousLocation: boolean;
    }>({
        initialLocationKey: location.key,
        latestLocationKey: location.key,
        locationKey: location.key,
        hasNextLocation: false,
        hasPreviousLocation: false,
    });

    if (navigationState.locationKey !== location.key) {
        setNavigationState({
            initialLocationKey: navigationState.initialLocationKey,
            latestLocationKey:
                navigationType === Action.Push ? location.key : navigationState.latestLocationKey,
            locationKey: location.key,
            hasNextLocation:
                navigationType === Action.Pop && location.key !== navigationState.latestLocationKey,
            hasPreviousLocation:
                navigationType === Action.Push ||
                location.key !== navigationState.initialLocationKey,
        });
    }

    // Read our current navigation state from `sessionStorage` and use it to
    // initialize our component's state.
    useEffect(() => {
        const navigationStateString = sessionStorage.getItem("cyberworlds/navigationState");
        if (navigationStateString) {
            setNavigationState(
                NavigationStateSchema.deserialize(JSON.parse(navigationStateString)),
            );
        }
    }, []);

    useEffect(() => {
        sessionStorage.setItem(
            "cyberworlds/navigationState",
            JSON.stringify(NavigationStateSchema.serialize(navigationState)),
        );
    }, [navigationState]);

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

    return (
        <MenuButton
            placement="right-end"
            actions={[
                {
                    icon: <SignOut />,
                    label: "Sign out",
                    pressErrorTitle: "Couldn’t sign out",
                    onPress: () => rootNavigate("/sign-out"),
                },
            ]}
        >
            <IconButton
                size="lg"
                variant="accent"
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
