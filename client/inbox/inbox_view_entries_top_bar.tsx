import {Box} from "~/client/design/box.js";
import {InboxViewTopBarModeToggleButton} from "~/client/inbox/inbox_view_top_bar_mode_toggle_button.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";

export function InboxViewEntriesTopBar({filter}: {filter: "New" | "Archive"}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    return (
        <Box
            flexShrink="0"
            height="10"
            backgroundColor="grey-0"
            borderBottom="grey-10"
            position="relative"
            zIndex="10"
            display="flex"
            alignItems="center"
        >
            <Box flexGrow="1" paddingLeft="3" fontSize="200" fontStyle="semi-bold">
                Inbox
            </Box>
            <Box flexShrink="0" paddingRight="2">
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
