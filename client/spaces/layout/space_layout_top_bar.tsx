import GraphemeSplitter from "grapheme-splitter";
import {useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {SpaceLayoutTopBarCreateButton} from "~/client/spaces/layout/internal/space_layout_top_bar_create_button.js";
import {SpaceLayoutTopBarInboxButton} from "~/client/spaces/layout/internal/space_layout_top_bar_inbox_button.js";
import {SpaceLayoutTopBarSearchInput} from "~/client/spaces/layout/internal/space_layout_top_bar_search_input.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

// TODO(calebmer): Keyboard shortcuts for everything in top bar

export function SpaceLayoutTopBar({
    space,
    initialInbox,
    onSearchInputPress,
}: {
    space: SpaceModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
    onSearchInputPress: () => void;
}) {
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
                <SpaceLayoutTopBarSearchInput space={space} onPress={onSearchInputPress} />
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
                <SpaceLayoutTopBarInboxButton initialInbox={initialInbox} />
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
