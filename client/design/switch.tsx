import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useReporter} from "~/client/design/reporter.js";
import {SwitchIcon} from "~/client/design/switch_icon.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useTouchSlop} from "~/client/design/use_touch_slop.js";
import {fontSizes, spinAnimationClassName, sprinkles} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export function Switch({
    isDisabled,
    isSelected,
    onChange,
    changeErrorTitle,
    fontSize = "75",
    color = "grey-100",
    children,
}: {
    isDisabled?: boolean;
    isSelected: boolean;
    onChange?: (isSelected: boolean) => MaybePromise<void>;
    changeErrorTitle?: string;
    fontSize?: "75" | "100";
    color?: "grey-60" | "grey-70" | "grey-80" | "grey-90" | "grey-100";
    children: ReactNode;
}) {
    const reporter = useReporter();

    const [pendingState, setPendingState] = useState<{isSelected: boolean} | null>(null);

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(!!pendingState);

    const {isPressed, pressProps} = usePress({
        isDisabled,
        onPress: event => {
            if (isDisabled || pendingState) return;

            const defaultChangeErrorTitle =
                event.pointerType === "touch"
                    ? "The switch you tapped didn’t work"
                    : "The switch you clicked didn’t work";

            let promise;
            try {
                promise = onChange?.(!isSelected);
            } catch (error) {
                reporter.displayError(changeErrorTitle ?? defaultChangeErrorTitle, error);
                return;
            }

            // If the press returns a promise:
            //
            // - Show a loading spinner after a short delay
            // - Show a toast if there was an error
            if (promise instanceof Promise) {
                setPendingState({isSelected: !isSelected});

                assert(
                    changeErrorTitle,
                    "If `onChange` returns a promise then the `changeErrorTitle` prop is required",
                );

                promise.then(
                    () => {
                        setPendingState(null);
                    },
                    error => {
                        setPendingState(null);
                        reporter.displayError(changeErrorTitle, error);
                    },
                );
            }
        },
    });

    const {height, iconSize, gap, pendingSpinnerGap} = (
        {
            "75": {
                height: "4",
                iconSize: "3",
                gap: "1.5",
                pendingSpinnerGap: "1",
            },
            "100": {
                height: "5",
                iconSize: "4",
                gap: "2",
                pendingSpinnerGap: "1.5",
            },
        } as const
    )[fontSize];

    const touchSlop = useTouchSlop(height);

    return (
        <FocusRing insetY={touchSlop.slop}>
            <Box
                {...pressProps}
                tabIndex={isDisabled ? -1 : 0}
                color={isDisabled ? "grey-30" : color}
                fontSize={fontSize}
                height={touchSlop.sizeWithSlop}
                maxWidth="full"
                marginY={`-${touchSlop.slop}`}
                // `inline-flex` so the element width is the width of our contents instead of
                // the width of the parent. Our width is visible when a `<FocusRing>` is
                // rendered.
                display="inline-flex"
                alignItems="flex-start"
            >
                <Box
                    display="flex"
                    alignItems="center"
                    flexShrink="0"
                    style={{height: fontSizes[fontSize].lineHeight}}
                >
                    <SwitchIcon
                        size={iconSize}
                        isSelected={pendingState?.isSelected ?? isSelected}
                        isPressed={isPressed}
                    />
                </Box>
                <Box
                    paddingLeft={gap}
                    position="relative"
                    paddingRight={shouldShowPendingSpinner ? pendingSpinnerGap : undefined}
                >
                    {children}
                </Box>
                {shouldShowPendingSpinner && (
                    <Box
                        display="flex"
                        alignItems="center"
                        flexShrink="0"
                        style={{height: fontSizes[fontSize].lineHeight}}
                    >
                        <SpinnerGap
                            className={classNames(
                                spinAnimationClassName,
                                sprinkles({flexShrink: "0"}),
                            )}
                            size={spacing[iconSize]}
                        />
                    </Box>
                )}
            </Box>
        </FocusRing>
    );
}
