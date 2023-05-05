import GraphemeSplitter from "grapheme-splitter";
import {MagnifyingGlass} from "phosphor-react";
import {useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {useShowToast} from "~/client/design/toast";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {useNavigate} from "~/client/remix/use_navigate";
import {SpaceLayoutTopBarCreateButton} from "~/client/spaces/layout/internal/space_layout_top_bar_create_button";
import {SpaceLayoutTopBarNotificationsButton} from "~/client/spaces/layout/internal/space_layout_top_bar_notifications_button";
import {useSpaceContext} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types";
import {UnimplementedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {InboxModel} from "~/shared/models/inbox_model";
import {SpaceModel} from "~/shared/models/space_model";

// TODO(calebmer): Keyboard shortcuts for everything in top bar

export function SpaceLayoutTopBar({
    space,
    initialInbox,
}: {
    space: SpaceModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const showToast = useShowToast();
    const isMobile = useIsMobile();

    return (
        <Box
            flexShrink="0"
            backgroundColor="grey-0"
            borderBottom="grey-10"
            position="relative"
            zIndex="10"
            height="10"
            display="flex"
            alignItems="center"
        >
            <Box
                width="48"
                display="flex"
                justifyContent="flex-start"
                alignItems="center"
                gap="2"
                paddingX="2"
            >
                <Box
                    backgroundColor="grey-30-const"
                    width="6"
                    height="6"
                    borderRadius="base"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    color="grey-80-const"
                >
                    <Box fontSize="75" style={{transform: `scale(${6 / 8})`}} aria-hidden="true">
                        {useMemo(() => {
                            const splitter = new GraphemeSplitter();
                            const graphemes = splitter.iterateGraphemes(space.name);
                            return graphemes.next().value;
                        }, [space.name])}
                    </Box>
                </Box>
                <Box fontSize="100" fontStyle="truncate-semi-bold">
                    {space.name}
                </Box>
            </Box>
            {!isMobile && (
                // NOTE(calebmer): For now the search bar looks whack on mobile. Since it's not
                // even implemented and only used to frame the design, hide it for now.
                <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                    <Box
                        minWidth="48"
                        maxWidth="96"
                        width="full"
                        border="grey-10"
                        borderRadius="md"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        padding="1"
                        gap="1.5"
                        color="grey-50"
                        cursor="text"
                        onClick={() => {
                            showToast({
                                type: "Error",
                                title: "Can not open search",
                                error: new UnimplementedError(
                                    "Search has not been implemented yet",
                                    {
                                        displayMessage: errorDisplayMessage`Search has not been implemented yet.`,
                                    },
                                ),
                            });
                        }}
                    >
                        <MagnifyingGlass size={spacing["3"]} />
                        <Box fontStyle="truncate">Search {space.name}…</Box>
                    </Box>
                </Box>
            )}
            <Box
                width="48"
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                gap="1"
                paddingX="2"
            >
                <SpaceLayoutTopBarCreateButton />
                <SpaceLayoutTopBarNotificationsButton initialInbox={initialInbox} />
                <Box paddingLeft="1">
                    <SpaceLayoutTopBarAccountButton />
                </Box>
            </Box>
        </Box>
    );
}

function SpaceLayoutTopBarAccountButton() {
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
                size="md"
                variant="accent"
                description="Account"
                // The notification bell does not have a tooltip. It opens up an inbox preview
                // on hover. It's weird if the buttons around it have tooltips.
                withoutTooltip={true}
            >
                <AccountAvatar account={currentAccount} size="6" />
            </IconButton>
        </MenuButton>
    );
}
