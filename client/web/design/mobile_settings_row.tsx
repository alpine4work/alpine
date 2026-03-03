import {Check, IconContext, SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {colorSchemeVars, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

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
    pressErrorTitle?: string;
    onPress: () => MaybePromise<void>;
    withBorderTop?: boolean;
    withoutBorderBottom?: boolean;
}) {
    const reporter = useReporter();

    const [isPending, setIsPending] = useState(false);
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    const {isPressed, pressProps} = usePress({
        onPress: event => {
            const defaultPressErrorTitle =
                event.pointerType === "touch"
                    ? "The setting you tapped didn\u2019t work"
                    : "The setting you clicked didn\u2019t work";

            let promise;
            try {
                promise = onPress?.();
            } catch (error) {
                reporter.displayError(pressErrorTitle ?? defaultPressErrorTitle, error);
                return;
            }

            // If the press returns a promise:
            //
            // - Show a loading spinner after a short delay
            // - Show a toast if there was an error
            if (promise instanceof Promise) {
                setIsPending(true);

                assert(
                    pressErrorTitle,
                    "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
                );

                promise.then(
                    () => {
                        setIsPending(false);
                    },
                    error => {
                        setIsPending(false);
                        reporter.displayError(pressErrorTitle, error);
                    },
                );
            }
        },
    });

    return (
        <Box
            {...pressProps}
            position="relative"
            zIndex="0"
            paddingX="2.5"
            paddingY="1.5"
            display="flex"
            alignItems="center"
            gap="2.5"
            style={{
                boxShadow:
                    !isPressed && (!withoutBorderBottom || withBorderTop)
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
                borderRadius="1"
                backgroundColor={isPressed ? "grey-10" : undefined}
                style={{
                    // Cover the previous button's border bottom. If the top border is rendered by our
                    // element then we don't need to go into the above sibling element's space.
                    top: withBorderTop ? 0 : -1,
                    bottom: 0,
                    left: `-${borderRadius["1"]}`,
                    right: `-${borderRadius["1"]}`,
                }}
            />
            {icon && iconPlacement === "leading" && (
                <Box flexShrink="0" color={isPressed ? "grey-100" : "grey-80"}>
                    <IconContext.Provider
                        value={{
                            size: spacing["4"],
                            // We need `<IconContext.Provider>` to set the actual color since brand icons (e.g.
                            // `<ChannelBrandIcon>`) need the actual color in context.
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
                            // We need `<IconContext.Provider>` to set the actual color since brand icons (e.g.
                            // `<ChannelBrandIcon>`) need the actual color in context.
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
