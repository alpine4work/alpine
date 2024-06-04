import {Check, IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {useShowToast} from "~/client/design/toast.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {spacing} from "~/shared/design/spacing.js";
import {borderRadius, colorSchemeVars, spinAnimationClassName} from "~/shared/styles/styles.js";

export function MobileSettingsRow({
    isSelected = false,
    icon,
    iconPlacement = "leading",
    label,
    pressErrorTitle,
    onPress,
    withBorderTop = false,
    withoutBorderBottom = false,
}: {
    isSelected?: boolean;
    icon?: ReactNode;
    iconPlacement?: "leading" | "trailing";
    label: ReactNode;
    pressErrorTitle: string;
    onPress: () => Promise<void>;
    withBorderTop?: boolean;
    withoutBorderBottom?: boolean;
}) {
    const showToast = useShowToast();

    const [isPending, setIsPending] = useState(false);
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            setIsPending(true);

            // Wrap in an async function so if `onPress` throws synchronously we get a
            // rejected promise that we handle below.
            const promise = (async () => await onPress())();

            promise.then(
                () => {
                    setIsPending(false);
                },
                error => {
                    setIsPending(false);

                    showToast({
                        type: "Error",
                        title: pressErrorTitle,
                        error,
                    });
                },
            );
        },
    });

    const {isHovered, hoverProps} = useHover({});

    return (
        <Box
            {...mergeProps(pressProps, hoverProps)}
            position="relative"
            zIndex="0"
            paddingX="2.5"
            paddingY="1.5"
            display="flex"
            alignItems="center"
            gap="2.5"
            style={{
                boxShadow:
                    !isPressed && !isHovered && (!withoutBorderBottom || withBorderTop)
                        ? [
                              ...(!withoutBorderBottom
                                  ? [`inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                  : []),
                              ...(withBorderTop
                                  ? [`inset 0 1px 0 0 ${colorSchemeVars["grey-5"]}`]
                                  : []),
                          ].join(", ")
                        : undefined,
            }}
        >
            <Box
                position="absolute"
                zIndex="-10"
                borderRadius="base"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
                style={{
                    // Cover the previous button's border bottom. If the top border is rendered by
                    // our element then we don't need to go into the above sibling element's space.
                    top: withBorderTop ? 0 : -1,
                    bottom: 0,
                    left: `-${borderRadius.base}`,
                    right: `-${borderRadius.base}`,
                }}
            />
            {icon && iconPlacement === "leading" && (
                <Box flexShrink="0" color={isPressed ? "grey-100" : "grey-80"}>
                    <IconContext.Provider
                        value={{
                            size: spacing["4"],
                            // We need `<IconContext.Provider>` to set the actual color since brand icons
                            // (e.g. `<ChannelBrandIcon>`) need the actual color in context.
                            color: isPressed
                                ? colorSchemeVars["grey-100"]
                                : colorSchemeVars["grey-80"],
                        }}
                    >
                        {icon}
                    </IconContext.Provider>
                </Box>
            )}
            <Box
                flexGrow="1"
                height="9"
                display="flex"
                flexDirection="column"
                justifyContent="center"
            >
                {label}
            </Box>
            {shouldShowPendingSpinner ? (
                <Box flexShrink="0" color="grey-70">
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                </Box>
            ) : icon && iconPlacement === "trailing" ? (
                <Box flexShrink="0" color={isPressed ? "grey-100" : "grey-80"}>
                    <IconContext.Provider
                        value={{
                            size: spacing["4"],
                            // We need `<IconContext.Provider>` to set the actual color since brand icons
                            // (e.g. `<ChannelBrandIcon>`) need the actual color in context.
                            color: isPressed
                                ? colorSchemeVars["grey-100"]
                                : colorSchemeVars["grey-80"],
                        }}
                    >
                        {icon}
                    </IconContext.Provider>
                </Box>
            ) : isSelected ? (
                <Box flexShrink="0" color={isPressed ? "grey-100" : "grey-70"}>
                    <Check size={spacing["4"]} />
                </Box>
            ) : null}
        </Box>
    );
}
