import {isFocusVisible} from "@react-aria/interactions";
import {
    ReactElement,
    Ref,
    RefCallback,
    RefObject,
    forwardRef,
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box.js";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px.js";
import {Overlay} from "~/client/design/overlay.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/helpers/refs/assign_ref.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Spacing} from "~/shared/design/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Sprinkles} from "~/shared/styles/styles.js";

const FocusRingForwardRef = forwardRef(FocusRing);
export {FocusRingForwardRef as FocusRing};

let currentActiveElement: HTMLElement | null = null;

/**
 * Our focus ring component is modeled after how [Discord built their focus
 * ring][1]. Instead of using native browser outlines that get clipped in
 * `overflow: hidden` containers, we render an element on top of the focused
 * target. We reuse our `<Overlay>` component for this.
 *
 * [1]: https://discord.com/blog/how-discord-implemented-app-wide-keyboard-navigation
 */
function FocusRing(
    {
        offset,
        insetX,
        insetBottom,
        isVisible: isAlwaysVisible = false,
        isDisabled = false,
        shouldIgnoreFocusEvents = false,
        isVisibleWhenFocusWithin = false,
        isVisibleFromAnyFocus = false,
        overlayZIndex,
        children,
        targetElement,
    }: {
        /**
         * How far away to position the focus ring from the focusable element.
         *
         * Defaults to `0.5`.
         *
         * Setting to `border` will render the focus ring on top of the
         * element's border. (Equivalent to a -1px offset.)
         *
         * Setting to `inset` will render the focus ring inside of the element.
         */
        offset?: Spacing | "border" | "inset";

        /**
         * How far in on the X axis we should inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the X axis is
         * `offset - insetX`.
         */
        insetX?: Spacing;

        /**
         * How far from the bottom should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the bottom is
         * `offset - insetBottom`.
         */
        insetBottom?: Spacing;

        /**
         * Is the focus ring always visible regardless of whether the target
         * is focused?
         *
         * We have logic that only one focus ring may be visible at a time but this
         * prop does not affect it. So another ring may be visible due to focus in
         * addition to this one.
         */
        isVisible?: boolean;

        /**
         * Is the focus ring hidden regardless of whether the target is focused?
         *
         * We have logic that only one focus ring may be visible at a time but this
         * prop does not affect it. So another ring may be hidden due to focus inside
         * of this.
         */
        isDisabled?: boolean;

        /**
         * Should ignore focus events on our target element. If this is true then only
         * `isVisible` controls whether the focus ring is visible or not.
         */
        shouldIgnoreFocusEvents?: boolean;

        /**
         * By default, we only show the focus ring when the direct child is focused.
         * When turning this prop on if any child is focused we will also show the
         * focus ring.
         */
        isVisibleWhenFocusWithin?: boolean;

        /**
         * Is this ring visible from any kind of focus? By default we only show the
         * focus ring on keyboard focus.
         */
        isVisibleFromAnyFocus?: boolean;

        /**
         * The z-index to render our overlay at. By default it renders at 0. Only
         * affects z-index relative to other overlays since our overlay container
         * creates a z-index stacking context.
         */
        overlayZIndex?: Sprinkles["zIndex"];

        /**
         * The focusable element we draw a ring around.
         */
        children?: ReactElement;

        /**
         * The focusable element we draw a ring around. Use this if your focusable
         * element is not managed by React. Otherwise prefer `children`. Can not
         * provide both `children` and `targetElement`.
         */
        targetElement?: HTMLElement;
    },
    foreignRef: Ref<HTMLElement>,
) {
    const targetRef = useRef<HTMLElement | null>(null);

    const [isVisible, visibilityRef] = useIsFocusRingVisible({
        shouldIgnoreFocusEvents,
        isVisibleWhenFocusWithin,
        isVisibleFromAnyFocus,
    });

    const mergedTargetRef = useMemo(() => {
        return (element: HTMLElement | null) => {
            assignRef(foreignRef, element);
            targetRef.current = element;
            visibilityRef(element);
        };
    }, [foreignRef, visibilityRef]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!targetElement) return;
        assignRef(mergedTargetRef, targetElement);
        return () => assignRef(mergedTargetRef, null);
    }, [mergedTargetRef, targetElement]);

    return (
        <Overlay
            isVisible={(isAlwaysVisible || isVisible) && !isDisabled}
            placement="center"
            preventOverflow={false}
            sameWidth={true}
            sameHeight={true}
            overlay={
                <Box pointerEvents="none" position="relative" zIndex={overlayZIndex}>
                    <FocusRingBox
                        offset={offset}
                        insetX={insetX}
                        insetBottom={insetBottom}
                        targetRef={targetRef}
                    />
                </Box>
            }
            children={useElementWithRef(children, mergedTargetRef)}
            targetElement={targetElement}
        />
    );
}

/**
 * State that controls `<FocusRing>`'s visibility in case you need to build a
 * custom focus ring out of `useIsFocusRingVisible()` and `<FocusRingBox>`.
 */
export function useIsFocusRingVisible({
    shouldIgnoreFocusEvents = false,
    isVisibleWhenFocusWithin = false,
    isVisibleFromAnyFocus = false,
}: {
    shouldIgnoreFocusEvents?: boolean;
    isVisibleWhenFocusWithin?: boolean;
    isVisibleFromAnyFocus?: boolean;
} = {}): [isVisible: boolean, targetRef: RefCallback<HTMLElement>] {
    const [isActive, setIsActive] = useState(false);

    const hasInitiallyMountedRef = useRef(false);

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            if (shouldIgnoreFocusEvents) {
                if (currentActiveElement === targetElement) currentActiveElement = null;
                setIsActive(false);
                return;
            }

            const isActive = () => {
                // If there is an element focused...
                if (!document.activeElement) return false;

                // And there is not another element with a focus ring. This may happen when
                // `isVisibleWhenFocusWithin` is true and we have a child with a `<FocusRing>`.
                if (currentActiveElement && currentActiveElement !== targetElement) return false;

                // Either:
                //
                // 1. We are the focused element
                // 2. A child is focused and `isVisibleWhenFocusWithin` is true.
                const isFocused =
                    document.activeElement === targetElement ||
                    (isVisibleWhenFocusWithin && targetElement.contains(document.activeElement));

                if (!isFocused) return false;

                // Only show the focus ring when we are in a keyboard interaction modality.
                // (Unless otherwise specified.) We cache whether focus is visible instead of
                // relying on a prop since if the interaction modality changes from keyboard
                // to mouse we'd like to keep the ring.
                return isVisibleFromAnyFocus || isFocusVisible();
            };

            let isFocused =
                // If we are initially mounting, don't consider the element to be focused so
                // `update()` actually updates our state.
                hasInitiallyMountedRef.current &&
                (isVisibleWhenFocusWithin
                    ? targetElement.contains(document.activeElement)
                    : document.activeElement === targetElement);

            const update = (event?: FocusEvent) => {
                const focusedElement =
                    event?.type === "focusout"
                        ? (event.relatedTarget as Node | null)
                        : document.activeElement;

                const nextIsFocused = isVisibleWhenFocusWithin
                    ? targetElement.contains(focusedElement)
                    : focusedElement === targetElement;

                // Only update our active state if focus is moving in or out of the target
                // element. Not if focus is moving within sub-elements of the target element.
                //
                // This way if we have an input (like a date input) comprised of multiple
                // focusable segments, clicking in then keyboard navigating doesn't show the
                // focus ring.
                if (isFocused !== nextIsFocused) {
                    isFocused = nextIsFocused;

                    // Immediately re-render the focus ring. That way if we have any state changing
                    // the visuals of an element in `onFocus` or `onBlur` we don't have a tear with
                    // the focus ring in a weird state.
                    runWithImmediatePriority(() => {
                        if (isActive()) {
                            currentActiveElement = targetElement;
                            setIsActive(true);
                        } else {
                            if (currentActiveElement === targetElement) currentActiveElement = null;
                            setIsActive(false);
                        }
                    });
                }
            };

            // Update our focus state on initial mount.
            //
            // This is necessary for elements that are keyboard focused on mount. For
            // example, try editing a comment with the keyboard. It should get a
            // focus ring.
            //
            // However, we don't want to update the focus state on prop change. For
            // example, try clicking into an account picker (focus is not visible, no ring)
            // then using arrow keys to select an account (account should get ring) then
            // hitting enter to select the account (focus returned to text input which
            // should not have ring, it stayed focused and maintained its inactive focus
            // ring state).
            if (!hasInitiallyMountedRef.current) {
                hasInitiallyMountedRef.current = true;
                update();
            }

            // Use `focusin`/`focusout` instead of `focus`/`blur` because the
            // former bubbles.
            targetElement.addEventListener("focusin", update);
            targetElement.addEventListener("focusout", update);
            return () => {
                targetElement.removeEventListener("focusin", update);
                targetElement.removeEventListener("focusout", update);
            };
        },
        [isVisibleFromAnyFocus, isVisibleWhenFocusWithin, shouldIgnoreFocusEvents],
    );

    return [isActive, useLifecycleRef(targetLifecycleRef)];
}

/**
 * Is a child rendering a focus ring?
 */
export function useIsChildFocusRingVisible(): [
    isVisible: boolean,
    targetRef: RefCallback<HTMLElement>,
] {
    const [isChildFocusRingVisible, setIsChildFocusRingVisible] = useState(false);

    const hasInitiallyMountedRef = useRef(false);

    const targetLifecycleRef = useCallback((targetElement: HTMLElement) => {
        const update = () => {
            // Immediately re-render since focus rings are rendered immediately.
            runWithImmediatePriority(() => {
                setIsChildFocusRingVisible(targetElement.contains(currentActiveElement));
            });
        };

        // Update our focus state on initial mount.
        if (!hasInitiallyMountedRef.current) {
            hasInitiallyMountedRef.current = true;
            update();
        }

        // Use `focusin`/`focusout` instead of `focus`/`blur` because the
        // former bubbles.
        targetElement.addEventListener("focusin", update);
        targetElement.addEventListener("focusout", update);
        return () => {
            targetElement.removeEventListener("focusin", update);
            targetElement.removeEventListener("focusout", update);
        };
    }, []);

    return [isChildFocusRingVisible, useLifecycleRef(targetLifecycleRef)];
}

export function FocusRingBox({
    offset = "0.5",
    insetX = "0",
    insetBottom = "0",
    targetRef,
}: {
    offset?: Spacing | "border" | "inset";
    insetX?: Spacing;
    insetBottom?: Spacing;
    targetRef: RefObject<HTMLElement | null>;
}) {
    const ringRef = useRef<HTMLDivElement>(null);

    const ringWidthPx = 2;

    // Overlay must be focused to render so we know we're on the client and
    // `window` should exist.
    let ringOffsetBasePx = useSpacingPx(offset !== "border" && offset !== "inset" ? offset : "0");

    // If we are using a border ring offset, we want the focus ring to render on
    // top of the element's 1px border.
    if (offset === "border") ringOffsetBasePx = -1;

    // If we are using an inset offset, we want the focus ring to render entirely
    // inside the element.
    if (offset === "inset") ringOffsetBasePx = -ringWidthPx;

    const ringInsetXPx = useSpacingPx(insetX);
    const ringInsetBottomPx = useSpacingPx(insetBottom);

    const ringOffsetXPx = ringOffsetBasePx - ringInsetXPx;
    const ringOffsetTopPx = ringOffsetBasePx;
    const ringOffsetBottomPx = ringOffsetBasePx - ringInsetBottomPx;

    useLayoutEffect(() => {
        const run = () => {
            assert(ringRef.current && targetRef.current);

            const targetStyle = getComputedStyle(targetRef.current);

            const ringStyle = {
                borderTopLeftRadius: parseBorderRadius(targetStyle.borderTopLeftRadius),
                borderTopRightRadius: parseBorderRadius(targetStyle.borderTopRightRadius),
                borderBottomLeftRadius: parseBorderRadius(targetStyle.borderBottomLeftRadius),
                borderBottomRightRadius: parseBorderRadius(targetStyle.borderBottomRightRadius),
            };

            // Tweak border radius because of our ring offset. Using formula:
            //
            // ```
            // outerRadius = innerRadius + (outerSize - innerSize) / 2
            // ```
            //
            // In this case we know:
            //
            // ```
            // outerSize = innerSize + ringOffset * 2 + ringWidth * 2
            // ```
            //
            // So our formula simplifies as follows:
            //
            // ```
            // outerRadius = innerRadius + (innerSize + ringOffset * 2 + ringWidth * 2 - innerSize) / 2
            // outerRadius = innerRadius + (ringOffset * 2 + ringWidth * 2) / 2
            // outerRadius = innerRadius + ringOffset + ringWidth
            // ```
            //
            // Formula is from:
            // https://twitter.com/joshwcomeau/status/1349782080021028865?lang=en

            if (typeof ringStyle.borderTopLeftRadius === "number") {
                ringRef.current.style.borderTopLeftRadius = `${
                    ringStyle.borderTopLeftRadius + ringOffsetBasePx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderTopLeftRadius = ringStyle.borderTopLeftRadius;
            }

            if (typeof ringStyle.borderTopRightRadius === "number") {
                ringRef.current.style.borderTopRightRadius = `${
                    ringStyle.borderTopRightRadius + ringOffsetBasePx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderTopRightRadius = ringStyle.borderTopRightRadius;
            }

            if (typeof ringStyle.borderBottomLeftRadius === "number") {
                ringRef.current.style.borderBottomLeftRadius = `${
                    ringStyle.borderBottomLeftRadius + ringOffsetBasePx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderBottomLeftRadius = ringStyle.borderBottomLeftRadius;
            }

            if (typeof ringStyle.borderBottomRightRadius === "number") {
                ringRef.current.style.borderBottomRightRadius = `${
                    ringStyle.borderBottomRightRadius + ringOffsetBasePx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderBottomRightRadius = ringStyle.borderBottomRightRadius;
            }
        };

        // Run in a microtask so that parent effects which assign refs run first.
        let isCancelled = false;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            run();
        });
        return () => {
            isCancelled = true;
        };
    }, [ringOffsetBasePx, targetRef]);

    return (
        <Box
            ref={ringRef}
            border="theme-30-const"
            style={{
                width: `calc(100% + ${ringWidthPx * 2 + ringOffsetXPx * 2}px)`,
                height: `calc(100% + ${ringWidthPx * 2 + ringOffsetTopPx + ringOffsetBottomPx}px)`,
                transform: `translate(${-(ringWidthPx + ringOffsetXPx)}px, ${-(
                    ringWidthPx + ringOffsetTopPx
                )}px)`,
                borderWidth: ringWidthPx,
            }}
        />
    );
}

function parseBorderRadius(borderRadiusStyle: string): number | string {
    if (!borderRadiusStyle.endsWith("px")) return borderRadiusStyle;

    const borderRadiusPx = parseInt(borderRadiusStyle.slice(0, -2), 10);
    return isNaN(borderRadiusPx) ? borderRadiusStyle : borderRadiusPx;
}
