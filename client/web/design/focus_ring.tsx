import {ReactElement, Ref, RefObject, forwardRef, useLayoutEffect, useMemo, useRef} from "react";
import {Overlay} from "~/client/web/design/overlay.js";
import {useIsFocusRingVisible} from "~/client/web/design/use_is_focus_ring_visible.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";
import {useElementWithRef} from "~/client/web/helpers/refs/use_element_with_ref.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {Sprinkles, sprinkles} from "~/client/web/styles/styles.js";
import {Spacing, convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";

const FocusRingForwardRef = forwardRef(FocusRing);
export {FocusRingForwardRef as FocusRing};

const overlayClassName = sprinkles({
    pointerEvents: "none",
    position: "relative",
});

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
        inset,
        insetX,
        insetY,
        insetLeft,
        insetRight,
        insetTop,
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
         * How far in should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset is
         * `offset - inset`.
         */
        inset?: Spacing | `-${Spacing}`;

        /**
         * How far in on the X axis we should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the X axis is
         * `offset - insetX`.
         */
        insetX?: Spacing | `-${Spacing}`;

        /**
         * How far in on the Y axis we should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the Y axis is
         * `offset - insetY`.
         */
        insetY?: Spacing | `-${Spacing}`;

        /**
         * How far from the left should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the left is
         * `offset - insetLeft`.
         */
        insetLeft?: Spacing | `-${Spacing}`;

        /**
         * How far from the right should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the right is
         * `offset - insetRight`.
         */
        insetRight?: Spacing | `-${Spacing}`;

        /**
         * How far from the top should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the top is
         * `offset - insetTop`.
         */
        insetTop?: Spacing | `-${Spacing}` | "border";

        /**
         * How far from the bottom should we inset our focus ring?
         *
         * This will be subtracted from `offset`. So the true offset on the bottom is
         * `offset - insetBottom`.
         */
        insetBottom?: Spacing | "border";

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
                <div
                    data-testid={process.env.NODE_ENV !== "production" ? "FocusRing" : undefined}
                    // Optimization: `<FocusRing>` is rendered hot code paths. Don't call
                    // `sprinkles()` if we can avoid it.
                    className={
                        overlayZIndex
                            ? `${overlayClassName} ${sprinkles({zIndex: overlayZIndex})}`
                            : overlayClassName
                    }
                >
                    <FocusRingBox
                        offset={offset}
                        inset={inset}
                        insetX={insetX}
                        insetY={insetY}
                        insetLeft={insetLeft}
                        insetRight={insetRight}
                        insetTop={insetTop}
                        insetBottom={insetBottom}
                        targetRef={targetRef}
                    />
                </div>
            }
            children={useElementWithRef(children, mergedTargetRef)}
            targetElement={targetElement}
        />
    );
}

export function FocusRingBox({
    offset = "0.5",
    inset: insetProp,
    insetX: insetXProp,
    insetY: insetYProp,
    insetTop: insetTopProp,
    insetBottom: insetBottomProp,
    insetLeft: insetLeftProp,
    insetRight: insetRightProp,
    targetRef,
}: {
    offset?: Spacing | "border" | "inset";
    inset?: Spacing | `-${Spacing}`;
    insetX?: Spacing | `-${Spacing}`;
    insetY?: Spacing | `-${Spacing}`;
    insetTop?: Spacing | `-${Spacing}` | "border";
    insetBottom?: Spacing | `-${Spacing}` | "border";
    insetLeft?: Spacing | `-${Spacing}`;
    insetRight?: Spacing | `-${Spacing}`;
    targetRef: RefObject<HTMLElement | null>;
}) {
    const insetTop = insetTopProp ?? insetYProp ?? insetProp ?? "0";
    const insetBottom = insetBottomProp ?? insetYProp ?? insetProp ?? "0";
    const insetLeft = insetLeftProp ?? insetXProp ?? insetProp ?? "0";
    const insetRight = insetRightProp ?? insetXProp ?? insetProp ?? "0";

    const ringRef = useRef<HTMLDivElement>(null);

    const ringWidthPx = 2;

    const spacingScale = useSpacingScale();

    // Overlay must be focused to render so we know we're on the client and
    // `window` should exist.
    let ringOffsetBasePx =
        offset === "border"
            ? -1
            : offset === "inset"
              ? -ringWidthPx
              : convertRemLengthToPx(offset, spacingScale);

    // If we are using a border ring offset, we want the focus ring to render on
    // top of the element's 1px border.
    if (offset === "border") ringOffsetBasePx = -1;

    // If we are using an inset offset, we want the focus ring to render entirely
    // inside the element.
    if (offset === "inset") ringOffsetBasePx = -ringWidthPx;

    const ringInsetTopPx = insetTop === "border" ? 1 : convertRemLengthToPx(insetTop, spacingScale);
    const ringInsetBottomPx =
        insetBottom === "border" ? 1 : convertRemLengthToPx(insetBottom, spacingScale);
    const ringInsetLeftPx = convertRemLengthToPx(insetLeft, spacingScale);
    const ringInsetRightPx = convertRemLengthToPx(insetRight, spacingScale);

    const ringOffsetTopPx = ringOffsetBasePx - ringInsetTopPx;
    const ringOffsetBottomPx = ringOffsetBasePx - ringInsetBottomPx;
    const ringOffsetLeftPx = ringOffsetBasePx - ringInsetLeftPx;
    const ringOffsetRightPx = ringOffsetBasePx - ringInsetRightPx;

    useLayoutEffect(() => {
        const run = () => {
            assert(ringRef.current && targetRef.current);

            const targetStyle = getComputedStyle(targetRef.current);

            const ringStyle = {
                borderTopLeftRadius: parseCssLength(targetStyle.borderTopLeftRadius, spacingScale),
                borderTopRightRadius: parseCssLength(
                    targetStyle.borderTopRightRadius,
                    spacingScale,
                ),
                borderBottomLeftRadius: parseCssLength(
                    targetStyle.borderBottomLeftRadius,
                    spacingScale,
                ),
                borderBottomRightRadius: parseCssLength(
                    targetStyle.borderBottomRightRadius,
                    spacingScale,
                ),
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
    }, [ringOffsetBasePx, spacingScale, targetRef]);

    return (
        <div
            ref={ringRef}
            className={sprinkles({border: "theme-40-const"})}
            style={{
                width: `calc(100% + ${ringWidthPx * 2 + ringOffsetLeftPx + ringOffsetRightPx}px)`,
                height: `calc(100% + ${ringWidthPx * 2 + ringOffsetTopPx + ringOffsetBottomPx}px)`,
                transform: `translate(${-(ringWidthPx + ringOffsetLeftPx)}px, ${-(
                    ringWidthPx + ringOffsetTopPx
                )}px)`,
                borderWidth: ringWidthPx,
            }}
        />
    );
}

function parseCssLength(cssLength: string, spacingScale: SpacingScale): number | string {
    if (cssLength.endsWith("px")) {
        const cssLengthPx = parseInt(cssLength.slice(0, -2), 10);
        return isNaN(cssLengthPx) ? cssLength : cssLengthPx;
    }

    if (cssLength.endsWith("rem")) {
        const cssLengthRem = parseInt(cssLength.slice(0, -3), 10);
        return isNaN(cssLengthRem) ? cssLength : cssLengthRem * remPxBySpacingScale[spacingScale];
    }

    return cssLength;
}
