import {Action} from "@remix-run/router";
import GraphemeSplitter from "grapheme-splitter";
import {ArrowLeft, ArrowRight, Bell, House, IconContext, MagnifyingGlass} from "phosphor-react";
import {ReactNode, useEffect, useMemo, useState} from "react";
import {useLocation, useNavigationType} from "react-router";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {SpaceLayoutSideBarCreateButton} from "~/client/spaces/layout/internal/space_layout_side_bar_create_button.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceLayoutSideBar({
    space,
    initialInbox,
}: {
    space: SpaceModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    return (
        <Box
            flexShrink="0"
            display="flex"
            flexDirection="column"
            alignItems="center"
            backgroundColor="grey-0"
            borderRight="grey-10"
            style={{width: "4.5rem"}}
        >
            <Box paddingTop="5" display="flex" flexDirection="column" alignItems="center" gap="5">
                <Box display="flex" flexDirection="column" alignItems="center" gap="2">
                    <Box
                        backgroundColor="grey-30-const"
                        width="8"
                        height="8"
                        borderRadius="base"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        color="grey-80-const"
                    >
                        <Box
                            fontSize="75"
                            style={{transform: `scale(${8 / 8})`}}
                            aria-hidden="true"
                        >
                            {useMemo(() => {
                                const splitter = new GraphemeSplitter();
                                const graphemes = splitter.iterateGraphemes(space.name);
                                return graphemes.next().value;
                            }, [space.name])}
                        </Box>
                    </Box>
                    <SpaceLayoutSideBarNavigationButtons />
                </Box>
                <SpaceLayoutSideBarButton icon={<House />} label="Home" />
                <SpaceLayoutSideBarButton icon={<MagnifyingGlass />} label="Search" />
                <SpaceLayoutSideBarButton icon={<Bell />} label="Inbox" />
                <SpaceLayoutSideBarCreateButton />
            </Box>
            <Box flexGrow="1" />
            <Box paddingBottom="5">
                <SpaceLayoutSideBarAccountButton />
            </Box>
        </Box>
    );
}

// NOCOMMIT
function SpaceLayoutSideBarButton({icon, label}: {icon: ReactNode; label: string}) {
    return (
        <Box display="flex" flexDirection="column" alignItems="center" gap="0.5" color="grey-70">
            <Box
                width="7"
                height="7"
                borderRadius="full"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
                    {icon}
                </IconContext.Provider>
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
                onPress={() => window.history.back()}
            >
                <ArrowLeft />
            </IconButton>
            <IconButton
                size="xs"
                description="Go forwards"
                tooltipPlacement="top"
                isDisabled={!navigationState.hasNextLocation}
                onPress={() => window.history.forward()}
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
            placement="bottom-end"
            actions={[
                {
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
