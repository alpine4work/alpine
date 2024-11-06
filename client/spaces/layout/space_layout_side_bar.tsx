import {House, MagnifyingGlass, SignOut} from "phosphor-react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {usePreloadSearchByAffinity} from "~/client/search/use_search_state.js";
import {SpaceLayoutSideBarCreateButton} from "~/client/spaces/layout/internal/space_layout_side_bar_create_button.js";
import {SpaceLayoutSideBarInboxButton} from "~/client/spaces/layout/internal/space_layout_side_bar_inbox_button.js";
import {SpaceLayoutSideBarSpaceButton} from "~/client/spaces/layout/internal/space_layout_side_bar_space_button.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {documentContentEditorSidebarWidth} from "~/client/styles/document_shared_styles.js";
import {contentStyles, spaceLayoutStyles} from "~/client/styles/styles.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/core/spacing.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

const spaceLayoutSidebarWidthRem = parseRemLengthNumber(spaceLayoutStyles.sideBarWidth);

const spaceLayoutContainerWidthForMaxSidebarSpaceRem =
    parseRemLengthNumber(spacing[contentStyles.contentMaxWidth]) +
    parseRemLengthNumber(spacing[documentContentEditorSidebarWidth]) +
    parseRemLengthNumber(spacing["48"]);

const spaceLayoutMaxSidebarSpaceRem = spaceLayoutSidebarWidthRem;

const spaceLayoutContainerWidthForMinSidebarSpaceRem =
    spaceLayoutContainerWidthForMaxSidebarSpaceRem + spaceLayoutSidebarWidthRem;

const spaceLayoutMinSidebarSpaceRem = 0;

const spaceLayoutSidebarSpaceByContainerWidthRem =
    (spaceLayoutMinSidebarSpaceRem - spaceLayoutMaxSidebarSpaceRem) /
    (spaceLayoutContainerWidthForMinSidebarSpaceRem -
        spaceLayoutContainerWidthForMaxSidebarSpaceRem);

// On large screens we want to allocate 0 space for the sidebar. This will
// cause content to be visually centered on the screen ignoring space from the
// sidebar. But on smaller screens we need the sidebar to take up space in our
// layout so we don't end up rendering content underneath the sidebar.
//
// This `calc()` expression calculates the amount of space to allocate the
// sidebar based on the container width.
const spaceLayoutSidebarSpace = `clamp(${spaceLayoutMinSidebarSpaceRem}rem, ${spaceLayoutMaxSidebarSpaceRem}rem + (100% - ${spaceLayoutContainerWidthForMaxSidebarSpaceRem}rem) * ${spaceLayoutSidebarSpaceByContainerWidthRem}, ${spaceLayoutMaxSidebarSpaceRem}rem)`;

export function SpaceLayoutSideBar({
    space,
    initialInbox,
    isFullWidthRoute,
    onSearchPress,
}: {
    space: SpaceModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
    isFullWidthRoute: boolean;
    onSearchPress: () => void;
}) {
    const rootNavigate = useRootNavigate();
    const reporter = useReporter();
    const {isAppleDevice} = useClientInfo();

    // Preload affinitive search entities so they're ready when the search modal
    // opens. We expect search to be the primary way users navigate around the
    // product.
    usePreloadSearchByAffinity();

    return (
        <Box
            zIndex="30"
            position="relative"
            flexShrink="0"
            style={{
                // Routes that take up the full screen width always allocate space for the
                // space layout sidebar instead of using dynamic space that attempts to
                // visually center content.
                width: isFullWidthRoute ? spaceLayoutStyles.sideBarWidth : spaceLayoutSidebarSpace,
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
                backgroundColor="grey-0"
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
                            pressErrorTitle="Couldn’t open home page"
                            onPress={async () => {
                                if (space.alphaAccessDefaultChannelId) {
                                    await rootNavigate(
                                        `/s/${space.id}/channels/${space.alphaAccessDefaultChannelId}`,
                                    );
                                } else {
                                    reporter.displayError(
                                        "Can’t open the home page",
                                        new UnimplementedError(
                                            "The home page hasn't been implemented yet",
                                            {
                                                displayMessage: errorDisplayMessage`The home page hasn’t been implemented yet.`,
                                            },
                                        ),
                                    );
                                }
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
                    <SpaceLayoutSideBarAccountButton />
                </Box>
            </Box>
        </Box>
    );
}

function SpaceLayoutSideBarAccountButton() {
    const rootNavigate = useRootNavigate();
    const {currentAccount} = useSpaceContext();

    return (
        <MenuButton
            placement="right-end"
            actions={[
                {
                    icon: <SignOut />,
                    label: "Sign out",
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
