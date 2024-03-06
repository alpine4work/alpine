import {Check} from "phosphor-react";
import {useRef} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";

export function DocumentCommentThreadResolveButton() {
    const buttonRef = useRef<HTMLButtonElement>(null);

    const handlePress = () => {
        // NOCOMMIT: Implement
    };

    const {isPressed, pressProps} = usePress({
        onPress: handlePress,
    });

    return (
        <Box display="flex" alignItems="center">
            <IconButton
                ref={buttonRef}
                variant="outline"
                description="Mark as resolved"
                withoutTooltip={true}
                isPressed={isPressed}
                onPress={handlePress}
            >
                <Check size={spacing["4"]} color={colorSchemeVars["grey-70"]} />
            </IconButton>
            <Box
                // Not focusable since the `<IconButton>` is focusable.
                {...pressProps}
                alignSelf="stretch"
                display="flex"
                alignItems="center"
                paddingLeft="2"
                fontStyle="semi-bold"
            >
                Mark as resolved
            </Box>
        </Box>
    );
}
