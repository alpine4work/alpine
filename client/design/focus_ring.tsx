import {isFocusVisible} from "@react-aria/interactions";
import {
    ReactElement,
    Ref,
    RefObject,
    forwardRef,
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px";
import {Overlay} from "~/client/design/overlay";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {assignRef} from "~/client/helpers/refs/assign_ref";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {Spacing} from "~/shared/design/spacing";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";

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
        isVisible = false,
        shouldIgnoreFocusEvents = false,
        isVisibleWhenFocusWithin = false,
        isVisibleFromAnyFocus = false,
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
         * Is the focus ring always visible regardless of whether the target
         * is focused?
         *
         * We have logic that only one focus ring may be visible at a time but this
         * prop does not affect it. So another ring may be visible due to focus in
         * addition to this one.
         */
        isVisible?: boolean;

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
    const [isActive, setIsActive] = useState(false);
    const targetRef = useRef<HTMLElement | null>(null);

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            targetRef.current = targetElement;

            if (shouldIgnoreFocusEvents) {
                if (currentActiveElement === targetElement) currentActiveElement = null;
                setIsActive(false);
                return;
            }

            const isActive = () =>
                // If there is an element focused...
                document.activeElement &&
                // And there is not another element with a focus ring. This may happen when
                // `isVisibleWhenFocusWithin` is true and we have a child with a `<FocusRing>`.
                (!currentActiveElement || currentActiveElement === targetElement) &&
                // Either:
                //
                // 1. We are the focused element
                // 2. A child is focused and `isVisibleWhenFocusWithin` is true.
                (document.activeElement === targetElement ||
                    (isVisibleWhenFocusWithin && targetElement.contains(document.activeElement))) &&
                // Only show the focus ring when we are in a keyboard interaction modality.
                // (Unless otherwise specified.) We cache whether focus is visible instead of
                // relying on a prop since if the interaction modality changes from keyboard
                // to mouse we'd like to keep the ring.
                (isVisibleFromAnyFocus || isFocusVisible());

            const update = () => {
                if (isActive()) {
                    currentActiveElement = targetElement;
                    setIsActive(true);
                } else {
                    if (currentActiveElement === targetElement) currentActiveElement = null;
                    setIsActive(false);
                }
            };

            update();

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

    const mergedTargetRef = useMergedRefs(foreignRef, useLifecycleRef(targetLifecycleRef));

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!targetElement) return;
        assignRef(mergedTargetRef, targetElement);
        return () => assignRef(mergedTargetRef, null);
    }, [mergedTargetRef, targetElement]);

    return (
        <Overlay
            isVisible={isVisible || isActive}
            placement="center"
            preventOverflow={false}
            sameWidth={true}
            sameHeight={true}
            overlay={
                <Box pointerEvents="none">
                    <FocusRingBox offset={offset} targetRef={targetRef} />
                </Box>
            }
            children={useElementWithRef(children, mergedTargetRef)}
            targetElement={targetElement}
        />
    );
}

function FocusRingBox({
    offset = "0.5",
    targetRef,
}: {
    offset?: Spacing | "border" | "inset";
    targetRef: RefObject<HTMLElement | null>;
}) {
    const ringRef = useRef<HTMLDivElement>(null);

    const ringWidthPx = 2;

    // Overlay must be focused to render so we know we're on the client and
    // `window` should exist.
    let ringOffsetPx = useSpacingPx(offset !== "border" && offset !== "inset" ? offset : "0");

    // If we are using a border ring offset, we want the focus ring to render on
    // top of the element's 1px border.
    if (offset === "border") ringOffsetPx = -1;

    // If we are using an inset offset, we want the focus ring to render entirely
    // inside the element.
    if (offset === "inset") ringOffsetPx = -ringWidthPx;

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
                    ringStyle.borderTopLeftRadius + ringOffsetPx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderTopLeftRadius = ringStyle.borderTopLeftRadius;
            }

            if (typeof ringStyle.borderTopRightRadius === "number") {
                ringRef.current.style.borderTopRightRadius = `${
                    ringStyle.borderTopRightRadius + ringOffsetPx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderTopRightRadius = ringStyle.borderTopRightRadius;
            }

            if (typeof ringStyle.borderBottomLeftRadius === "number") {
                ringRef.current.style.borderBottomLeftRadius = `${
                    ringStyle.borderBottomLeftRadius + ringOffsetPx + ringWidthPx
                }px`;
            } else {
                ringRef.current.style.borderBottomLeftRadius = ringStyle.borderBottomLeftRadius;
            }

            if (typeof ringStyle.borderBottomRightRadius === "number") {
                ringRef.current.style.borderBottomRightRadius = `${
                    ringStyle.borderBottomRightRadius + ringOffsetPx + ringWidthPx
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
    }, [ringOffsetPx, targetRef]);

    return (
        <Box
            ref={ringRef}
            border="theme-30-const"
            style={{
                width: `calc(100% + ${ringWidthPx * 2 + ringOffsetPx * 2}px)`,
                height: `calc(100% + ${ringWidthPx * 2 + ringOffsetPx * 2}px)`,
                transform: `translate(-${ringWidthPx + ringOffsetPx}px, -${
                    ringWidthPx + ringOffsetPx
                }px)`,
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
