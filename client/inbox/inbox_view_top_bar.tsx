import {Box} from "~/client/design/box.js";
import {InboxViewTopBarModeToggleButton} from "~/client/inbox/inbox_view_top_bar_mode_toggle_button.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {desktopLayoutInboxBannerHeight} from "~/client/styles/inbox_shared_styles.js";

export function InboxViewTopBar({filter}: {filter: "New" | "Archive"}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    return (
        <Box
            flexShrink="0"
            width="full"
            height={desktopLayoutInboxBannerHeight}
            backgroundColor="grey-0"
            position="relative"
            zIndex="10"
            display="flex"
            alignItems="center"
        >
            <Box flexGrow="1" paddingLeft="4" fontSize="200" fontStyle="semi-bold">
                Inbox
            </Box>
            <Box flexShrink="0" paddingRight="3">
                <InboxViewTopBarModeToggleButton
                    filter={filter}
                    onNewPress={async () => {
                        if (filter === "New") return;
                        await navigate(`/s/${space.id}/inbox`);
                    }}
                    onArchivePress={async () => {
                        if (filter === "Archive") return;
                        await navigate(`/s/${space.id}/inbox?tab=old`);
                    }}
                />
            </Box>
        </Box>
    );
}
