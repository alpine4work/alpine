import {X} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";

export function MessageInputFilePreviewBase({
    onRemove,
    children,
}: {
    onRemove: () => void;
    children?: ReactNode;
}) {
    return (
        <Box position="relative" zIndex="0" width="20" height="20">
            <Box position="absolute" zIndex="20" top="-1" right="-1">
                <IconButton
                    size="xs"
                    variant="quiet-elevation-10"
                    description="Remove"
                    onPress={onRemove}
                    // Not focusable so clicking on this button doesn't unfocus
                    // the input.
                    isFocusable={false}
                >
                    <X />
                </IconButton>
            </Box>
            {children}
        </Box>
    );
}
