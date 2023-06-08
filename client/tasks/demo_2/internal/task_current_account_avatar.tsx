import {User} from "phosphor-react";
import {Box} from "~/client/design/box";
import {spacing} from "~/shared/design/spacing";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles";

export function TaskCurrentAccountAvatar() {
    return (
        <Box
            flexShrink="0"
            position="relative"
            width="5"
            height="5"
            borderRadius="full"
            style={{
                // Use box-shadow to draw border so it doesn't affect layout.
                boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-50"]}`,
            }}
        >
            <User
                size={spacing["3"]}
                color={colorSchemeVars["grey-50"]}
                className={sprinkles({
                    position: "absolute",
                    top: "1",
                    left: "1",
                })}
                weight="bold"
            />
        </Box>
    );
}
