import classNames from "classnames";
import {SpinnerGap} from "phosphor-react";
import {ReactNode, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useTouchSlop} from "~/client/web/design/use_touch_slop.js";
import {fontSizes, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";

export function Checkbox({
    isDisabled,
    isChecked,
    onChange,
    changeErrorTitle,
    color = "grey-100",
    children,
}: {
    isDisabled?: boolean;
    isChecked: boolean;
    onChange?: (isChecked: boolean) => MaybePromise<void>;
    changeErrorTitle?: string;
    color?: "grey-60" | "grey-70" | "grey-80" | "grey-90" | "grey-100";
    children: ReactNode;
}) {
    const reporter = useReporter();

    const [pendingState, setPendingState] = useState<{isChecked: boolean} | null>(null);

    // We wait a bit before showing our pending spinner. Some actions are very fast so
    // we delay showing a spinner to avoid a loading spinner flicker which can be
    // jarring.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(!!pendingState);

    const {isPressed, pressProps} = usePress({
        isDisabled,
        onPress: event => {
            if (isDisabled || pendingState) return;

            const defaultChangeErrorTitle =
                event.pointerType === "touch"
                    ? "The checkbox you tapped didn\u2019t work"
                    : "The checkbox you clicked didn\u2019t work";

            let promise;
            try {
                promise = onChange?.(!isChecked);
            } catch (error) {
                reporter.displayError(changeErrorTitle ?? defaultChangeErrorTitle, error);
                return;
            }

            // If the press returns a promise:
            //
            // - Show a loading spinner after a short delay
            // - Show a toast if there was an error
            if (promise instanceof Promise) {
                setPendingState({isChecked: !isChecked});

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

    const fontSize = "75";
    const touchSlop = useTouchSlop("4");

    return (
        <FocusRing insetY={touchSlop.slop}>
            <Box
                {...pressProps}
                tabIndex={isDisabled ? -1 : 0}
                color={isDisabled ? "grey-30" : color}
                fontSize={fontSize}
                minWidth="flex-fit"
                maxWidth="full"
                paddingY={touchSlop.slop}
                marginY={`-${touchSlop.slop}`}
                // `inline-flex` so the element width is the width of our contents instead of the
                // width of the parent. Our width is visible when a `<FocusRing>` is rendered.
                display="inline-flex"
                alignItems="flex-start"
            >
                <Box
                    display="flex"
                    alignItems="center"
                    flexShrink="0"
                    style={{height: fontSizes[fontSize].lineHeight}}
                >
                    <CheckboxIcon
                        isChecked={pendingState?.isChecked ?? isChecked}
                        isPressed={isPressed}
                    />
                </Box>
                <Box
                    paddingLeft="1.5"
                    position="relative"
                    paddingRight={shouldShowPendingSpinner ? "1" : undefined}
                    fontStyle="truncate"
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
                            size={spacing["3"]}
                        />
                    </Box>
                )}
            </Box>
        </FocusRing>
    );
}
