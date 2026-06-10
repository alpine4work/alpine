import {Globe, Lock} from "phosphor-react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {BuildingsIcon} from "~/client/web/icons/buildings_icon.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {elevation} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";

export const shareSwitchWidth = "12";

export function ShareSwitchBase({
    entityNoun,
    icon,
    isInert,
    onPress,
}: {
    entityNoun: string;
    icon: "Lock" | "Globe" | "Buildings";
    isInert?: boolean;
    onPress?: () => void;
}) {
    const {space} = useSpaceContext();

    const {pressProps, isPressed} = usePress({
        isDisabled: isInert,
        onPress,
    });

    return (
        <Tooltip
            isDisabled={isInert || icon !== "Lock"}
            content={`Share with everyone in ${space.name}`}
            placement="bottom-end"
            offsetAlong="2"
        >
            <FocusRing isDisabled={isInert}>
                <Box
                    {...pressProps}
                    tabIndex={0}
                    flexShrink="0"
                    role="button"
                    aria-label={`Toggle sharing with everyone in ${space.name}`}
                    aria-pressed={icon !== "Lock"}
                    width={shareSwitchWidth}
                    backgroundColor={
                        {
                            // TODO: If `theme` is green we need a different color for the URL grant. Right now
                            // the theme color is always indigo so hard coding green is fine.
                            Globe: {light: "green-30-const", dark: "green-40-const"} as const,
                            Buildings: {light: "theme-40-const", dark: "theme-50-const"} as const,
                            Lock: {
                                light: "grey-10-translucent",
                                dark: "grey-40-translucent",
                            } as const,
                        }[icon]
                    }
                    borderRadius="full"
                    overflow="hidden"
                    // We don't normally put cursor pointers on clickable things, but since this UI
                    // pattern is a little novel we want to make it really clear to users that this is
                    // a clickable switch.
                    cursor={!isInert ? "pointer" : undefined}
                    style={{
                        // We want our switch knob to be spacing 6 size (to match the size of a `md`
                        // `<IconButton>` and fit a size 4 icon). But we also want 2px of color around the
                        // knob to make it feel like the knob is inset into the switch's well. So take 2px
                        // of size away from the knob and add 2px of size to the switch well so in total
                        // the knob is 4px smaller than the well giving us our border.
                        height: `calc(${spacing["6"]} + 2px)`,
                        margin: -1,
                        transition: "background-color 150ms linear",
                    }}
                >
                    <Box
                        borderRadius="full"
                        style={{
                            width: `calc(${spacing["6"]} + 2px)`,
                            height: `calc(${spacing["6"]} + 2px)`,
                            padding: 2,
                            transform:
                                icon !== "Lock"
                                    ? `translateX(calc(${spacing["6"]} - 2px))`
                                    : undefined,
                            transition: "transform 150ms linear",
                        }}
                    >
                        <Box
                            position="relative"
                            zIndex="0"
                            overflow="hidden"
                            backgroundColor="grey-0-const"
                            borderRadius="full"
                            color="grey-70-const"
                            style={{
                                height: `calc(${spacing["6"]} - 2px)`,
                                boxShadow: `${elevation["elevation-10"].light}`,
                                width: isPressed
                                    ? `calc(${spacing["7"]} - 2px)`
                                    : `calc(${spacing["6"]} - 2px)`,
                                transform:
                                    isPressed && icon !== "Lock"
                                        ? `translateX(-${spacing["1"]})`
                                        : undefined,
                                transition: "width 50ms linear, transform 50ms linear",
                            }}
                        >
                            <Box
                                position="absolute"
                                zIndex="0"
                                inset="0"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                backgroundColor="grey-0-const"
                            >
                                <Lock
                                    size={spacing["4"]}
                                    role="img"
                                    aria-hidden={icon !== "Lock"}
                                    aria-label={`Icon indicating the ${entityNoun} is private`}
                                />
                            </Box>
                            <Box
                                position="absolute"
                                zIndex="10"
                                inset="0"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                backgroundColor="grey-0-const"
                                opacity={icon !== "Lock" ? "100" : "0"}
                                style={{
                                    transition: "opacity 100ms linear",
                                }}
                            >
                                <BuildingsIcon
                                    size={spacing["4"]}
                                    role="img"
                                    aria-hidden={icon !== "Buildings"}
                                    aria-label={`Icon indicating the ${entityNoun} is shared with everyone in ${space.name}`}
                                />
                            </Box>
                            <Box
                                position="absolute"
                                zIndex="20"
                                inset="0"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                backgroundColor="grey-0-const"
                                opacity={icon !== "Lock" && icon !== "Buildings" ? "100" : "0"}
                                style={{
                                    transition: "opacity 100ms linear",
                                }}
                            >
                                <Globe
                                    size={spacing["4"]}
                                    role="img"
                                    aria-hidden={icon !== "Globe"}
                                    aria-label={`Icon indicating the ${entityNoun} is shared with anyone with the link`}
                                />
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </FocusRing>
        </Tooltip>
    );
}
