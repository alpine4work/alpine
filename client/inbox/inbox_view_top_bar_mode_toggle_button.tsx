import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
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
        <Box display="flex" gap="1.5">
            <Button
                variant={filter === "New" ? "quiet-on" : "quiet-off"}
                height="6"
                paddingX="2"
                pressErrorTitle="Can’t open new notifications"
                onPress={onNewPress}
            >
                New
            </Button>
            <Button
                variant={filter === "Archive" ? "quiet-on" : "quiet-off"}
                height="6"
                paddingX="2"
                pressErrorTitle="Can’t open old notifications"
                onPress={onArchivePress}
            >
                Old
            </Button>
        </Box>
    );
}
