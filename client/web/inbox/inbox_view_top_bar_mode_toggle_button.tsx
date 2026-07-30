import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";

export function InboxViewTopBarModeToggleButton({
    filter,
    onNewPress,
    onArchivePress,
}: {
    filter: InboxEntryStatus;
    onNewPress: () => MaybePromise<void>;
    onArchivePress: () => MaybePromise<void>;
}) {
    return (
        <Box display="flex" gap="1">
            <Button
                variant={filter === "New" ? "quiet-on" : "quiet-off"}
                height="6"
                paddingX="2"
                pressErrorTitle="Can&#x2019;t open new notifications"
                onPress={onNewPress}
            >
                New
            </Button>
            <Button
                variant={filter === "Done" ? "quiet-on" : "quiet-off"}
                height="6"
                paddingX="2"
                pressErrorTitle="Can&#x2019;t open done notifications"
                onPress={onArchivePress}
            >
                Done
            </Button>
        </Box>
    );
}
