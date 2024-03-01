import {useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {MessageInputBase} from "~/client/messaging/message_input.js";
import {emptyMessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";

export function ContentEditorMobileCommentInputBottomBar() {
    const [state, setState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );

    return (
        <Box
            position="fixed"
            // Render above everything on the page including toolbar.
            zIndex="70"
            left="0"
            right="0"
            style={{
                // `bottom: "-" + nativeMobileBottomBarKeyboardToolbarHeightRem + "rem"` also
                // works except for in our Safari app keyboard support which limits the outlet
                // height to what's visible above the keyboard.
                bottom: `calc(100svh - var(--space-outlet-height, 100svh))`,
            }}
            // Bottom bar message input expects to be rendered in a flex context. Or else
            // some layout bits (like the bottom bar safe area cover) won't work
            // quite right.
            display="flex"
            flexDirection="column"
        >
            <MessageInputBase
                isBottomBar={true}
                marginX="3"
                state={state}
                onChange={setState}
                onSend={() => {
                    // NOCOMMIT: Implement!
                }}
            />
        </Box>
    );
}
