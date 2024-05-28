import {Action} from "@remix-run/router";
import {ArrowLeft, ArrowRight, House, MagnifyingGlass, SignOut} from "phosphor-react";
import {useEffect, useState} from "react";
import {useLocation, useNavigationType} from "react-router";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useShowToast} from "~/client/design/toast.js";
import {useNavigate, useRootNavigate} from "~/client/remix/use_navigate.js";
import {usePreloadAffinitiveSearchEntities} from "~/client/search/search_modal.js";
import {SpaceLayoutSideBarCreateButton} from "~/client/spaces/layout/internal/space_layout_side_bar_create_button.js";
import {SpaceLayoutSideBarInboxButton} from "~/client/spaces/layout/internal/space_layout_side_bar_inbox_button.js";
import {SpaceLayoutSideBarSpaceButton} from "~/client/spaces/layout/internal/space_layout_side_bar_space_button.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {RemLength} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export const spaceLayoutSideBarWidth: RemLength = "4.5rem";

export function SpaceLayoutSideBar({
    space,
    initialInbox,
    onSearchPress,
}: {
    space: SpaceModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
    onSearchPress: () => void;
}) {
    const rootNavigate = useRootNavigate();
    const showToast = useShowToast();

    // Preload affinitive search entities so they're ready when the search modal
    // opens. We expect search to be the primary way users navigate around the
    // product.
    usePreloadAffinitiveSearchEntities();

    return (
        <Box
            flexShrink="0"
            display="flex"
            flexDirection="column"
            alignItems="center"
            backgroundColor="grey-0"
            borderRight="grey-10"
            style={{width: spaceLayoutSideBarWidth}}
        >
            <Box paddingTop="5" display="flex" flexDirection="column" alignItems="center" gap="5">
                <SpaceLayoutSideBarSpaceButton space={space} />
                <Box display="flex" flexDirection="column" alignItems="center" gap="3">
                    <IconButton
                        size="lg"
                        description="Home"
                        tooltipPlacement="right"
                        pressErrorTitle="Couldn’t open home page"
                        onPress={async () => {
                            if (space.alphaAccessDefaultChannelId) {
                                await rootNavigate(
                                    `/s/${space.id}/channels/${space.alphaAccessDefaultChannelId}`,
                                );
                            } else {
                                showToast({
                                    type: "Error",
                                    title: "Can’t open the home page",
                                    error: new UnimplementedError(
                                        "The home page hasn't been implemented yet",
                                        {
                                            displayMessage: errorDisplayMessage`The home page hasn’t been implemented yet.`,
                                        },
                                    ),
                                });
                            }
                        }}
                    >
                        <House />
                    </IconButton>
                    <IconButton
                        size="lg"
                        description="Search"
                        tooltipPlacement="right"
                        keyboardShortcutHint="shift+shift"
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
                gap="2.5"
            >
                <SpaceLayoutSideBarAccountButton />
                <SpaceLayoutSideBarNavigationButtons />
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
        <Box flexShrink="0" display="flex" justifyContent="flex-start" alignItems="center" gap="1">
            <IconButton
                size="xs"
                description="Go back"
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
                tooltipPlacement="top"
                isDisabled={!navigationState.hasNextLocation}
                pressErrorTitle="Couldn’t go forwards"
                onPress={() => navigate(1)}
            >
                <ArrowRight />
            </IconButton>
        </Box>
    );
}

function SpaceLayoutSideBarAccountButton() {
    const navigate = useNavigate();
    const {currentAccount} = useSpaceContext();

    return (
        <MenuButton
            placement="right-end"
            actions={[
                {
                    icon: <SignOut />,
                    label: "Sign out",
                    onPress: () => navigate("/sign-out"),
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
