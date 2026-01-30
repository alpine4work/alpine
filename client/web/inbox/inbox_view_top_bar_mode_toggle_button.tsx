import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export function InboxViewTopBarModeToggleButton({
    filter,
    onNewPress,
    onArchivePress,
}: {
    filter: "New" | "Archive";
    onNewPress: () => MaybePromise<void>;
    onArchivePress: () => MaybePromise<void>;
}) {
    return (
        <Box display="flex" gap="1">
            <Button
                variant={filter === "New" ? "quiet-on" : "quiet-off"}
                height="6"
                paddingX="2"
                pressErrorTitle="Can\u2019t open new notifications"
                onPress={onNewPress}
            >
                New
            </Button>
            <Button
                variant={filter === "Archive" ? "quiet-on" : "quiet-off"}
                height="6"
                paddingX="2"
                pressErrorTitle="Can\u2019t open old notifications"
                onPress={onArchivePress}
            >
                Old
            </Button>
        </Box>
    );
}
