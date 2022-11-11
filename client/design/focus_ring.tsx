import {Instance, Rect, createPopper} from "@popperjs/core";
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
import {useFocusVisible} from "react-aria";
import {Box} from "~/client/design/box";
import {useElementWithRef} from "~/client/design/helpers/use_element_with_ref";
import {useLifecycleRef} from "~/client/design/helpers/use_lifecycle_ref";
import {useMergedRef} from "~/client/design/helpers/use_merged_ref";
import {useSpacingPx} from "~/client/design/helpers/use_spacing_px";
import {Overlay} from "~/client/design/overlay";
import {Spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";

const FocusRingForwardRef = forwardRef(FocusRing);
export {FocusRingForwardRef as FocusRing};

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
        children,
    }: {
        /**
         * How far away to position the focus ring from the focusable element.
         *
         * Defaults to `0.5`.
         */
        offset?: Spacing;

        /**
         * The focusable element we draw a ring around.
         */
        children: ReactElement;
    },
    foreignRef: Ref<HTMLElement>,
) {
    const [isFocused, setIsFocused] = useState(false);
    const targetRef = useRef<HTMLElement | null>(null);

    const {isFocusVisible} = useFocusVisible({
        // When `isTextInput` is true only "Tab" and "Escape" keys put us in visible
        // focus mode.
        isTextInput: true,
    });

    const targetLifecycleRef = useCallback((targetElement: HTMLElement) => {
        targetRef.current = targetElement;

        const handleFocus = (event: FocusEvent) => {
            if (event.target === event.currentTarget) {
                setIsFocused(true);
            }
        };

        const handleBlur = (event: FocusEvent) => {
            if (event.target === event.currentTarget) {
                setIsFocused(false);
            }
        };

        targetElement.addEventListener("focus", handleFocus);
        targetElement.addEventListener("blur", handleBlur);
        return () => {
            targetElement.removeEventListener("focus", handleFocus);
            targetElement.removeEventListener("blur", handleBlur);
        };
    }, []);

    return (
        <Overlay
            visible={isFocused && isFocusVisible}
            placement="center"
            preventOverflow={false}
            sameWidth={true}
            sameHeight={true}
            overlay={
                <Box pointerEvents="none">
                    <FocusRingBox offset={offset} targetRef={targetRef} />
                </Box>
            }
        >
            {useElementWithRef(
                children,
                useMergedRef(foreignRef, useLifecycleRef(targetLifecycleRef)),
            )}
        </Overlay>
    );
}

/**
 * A `<FocusRing>` but always visible and instead of targeting a React child it
 * targets a DOM node.
 */
export function FocusRingPortal({offset, element}: {offset?: Spacing; element: HTMLElement}) {
    const ringRef = useRef<HTMLDivElement>(null);
    const popperRef = useRef<Instance | null>(null);

    useLayoutEffect(() => {
        assert(ringRef.current);

        const popper = createPopper(element, ringRef.current, {
            placement: "top-start",
            modifiers: [
                {
                    name: "preventOverflow",
                    enabled: false,
                },
                {
                    name: "flip",
                    enabled: false,
                },
                {
                    name: "offset",
                    enabled: true,
                    options: {
                        offset: ({reference, popper}: {reference: Rect; popper: Rect}) => {
                            return [
                                reference.width / 2 - popper.width / 2,
                                -popper.height / 2 - reference.height / 2,
                            ];
                        },
                    },
                },
                {
                    name: "sameWidth",
                    enabled: true,
                    phase: "beforeWrite",
                    requires: ["computeStyles"],
                    fn: ({state}) => {
                        state.styles.popper!.width = `${state.rects.reference.width}px`;
                    },
                    effect: ({state}) => {
                        state.elements.popper.style.width = `${
                            (state.elements.reference as HTMLElement).offsetWidth
                        }px`;
                    },
                },
                {
                    name: "sameHeight",
                    enabled: true,
                    phase: "beforeWrite",
                    requires: ["computeStyles"],
                    fn: ({state}) => {
                        state.styles.popper!.height = `${state.rects.reference.height}px`;
                    },
                    effect: ({state}) => {
                        state.elements.popper.style.height = `${
                            (state.elements.reference as HTMLElement).offsetHeight
                        }px`;
                    },
                },
            ],
        });

        popperRef.current = popper;

        return () => {
            popperRef.current = null;
            popper.destroy();
        };
    }, [element]);

    // Update popper every React re-render.
    useLayoutEffect(() => {
        assert(popperRef.current);
        popperRef.current.forceUpdate();
    });

    const targetRef = useRef(element);
    useLayoutEffect(() => {
        targetRef.current = element;
    });

    return (
        <Box ref={ringRef} pointerEvents="none">
            <FocusRingBox offset={offset} targetRef={targetRef} />
        </Box>
    );
}

function FocusRingBox({
    offset = "0.5",
    targetRef,
}: {
    offset?: Spacing;
    targetRef: RefObject<HTMLElement | null>;
}) {
    const ringRef = useRef<HTMLDivElement>(null);

    const ringWidthPx = 2;
    const ringOffsetPx = useSpacingPx(offset);

    // Overlay must be focused to render so we know we're on the client and
    // `window` should exist.
    assert(ringOffsetPx !== null);

    useLayoutEffect(() => {
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
    }, [ringOffsetPx, targetRef]);

    return (
        <Box
            ref={ringRef}
            border="indigo-30"
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
