import {Tray} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";

export function InboxViewEntriesEmpty({filter}: {filter: InboxEntryStatus}) {
    return (
        <Box
            flexGrow="1"
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
            gap="2"
            color="grey-70"
        >
            <Tray size={spacing["9"]} weight="thin" />
            {filter === "New" ? (
                <Box>No new notifications</Box>
            ) : (
                <Box>
                    Notifications you mark as
                    <br />
                    done will appear here
                </Box>
            )}
        </Box>
    );
}
