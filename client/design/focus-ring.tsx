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
import {useElementWithRef} from "~/client/design/helpers/use-element-with-ref";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {useMergedRef} from "~/client/design/helpers/use-merged-ref";
import {Overlay} from "~/client/design/overlay";
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
function FocusRing({children}: {children: ReactElement}, foreignRef: Ref<HTMLElement>) {
    const [isFocused, setIsFocused] = useState(false);
    const ringStylesRef = useRef<FocusRingBoxRingStyles | null>(null);

    const {isFocusVisible} = useFocusVisible({
        // When `isTextInput` is true only "Tab" and "Escape" keys put us in visible
        // focus mode.
        isTextInput: true,
    });

    const targetLifecycleRef = useCallback((targetElement: HTMLElement) => {
        ringStylesRef.current = {
            borderTopLeftRadius: parseBorderRadius(
                getComputedStyle(targetElement).borderTopLeftRadius,
            ),
            borderTopRightRadius: parseBorderRadius(
                getComputedStyle(targetElement).borderTopRightRadius,
            ),
            borderBottomLeftRadius: parseBorderRadius(
                getComputedStyle(targetElement).borderBottomLeftRadius,
            ),
            borderBottomRightRadius: parseBorderRadius(
                getComputedStyle(targetElement).borderBottomRightRadius,
            ),
        };

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
                    <FocusRingBox ringStylesRef={ringStylesRef} />
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

type FocusRingBoxRingStyles = {
    borderTopLeftRadius: number | string;
    borderTopRightRadius: number | string;
    borderBottomLeftRadius: number | string;
    borderBottomRightRadius: number | string;
};

function FocusRingBox({ringStylesRef}: {ringStylesRef: RefObject<FocusRingBoxRingStyles | null>}) {
    const ringRef = useRef<HTMLDivElement>(null);

    const ringWidthPx = 2;
    const ringOffsetPx = 2;

    useLayoutEffect(() => {
        assert(ringRef.current && ringStylesRef.current);

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

        if (typeof ringStylesRef.current.borderTopLeftRadius === "number") {
            ringRef.current.style.borderTopLeftRadius = `${
                ringStylesRef.current.borderTopLeftRadius + ringOffsetPx + ringWidthPx
            }px`;
        } else {
            ringRef.current.style.borderTopLeftRadius = ringStylesRef.current.borderTopLeftRadius;
        }

        if (typeof ringStylesRef.current.borderTopRightRadius === "number") {
            ringRef.current.style.borderTopRightRadius = `${
                ringStylesRef.current.borderTopRightRadius + ringOffsetPx + ringWidthPx
            }px`;
        } else {
            ringRef.current.style.borderTopRightRadius = ringStylesRef.current.borderTopRightRadius;
        }

        if (typeof ringStylesRef.current.borderBottomLeftRadius === "number") {
            ringRef.current.style.borderBottomLeftRadius = `${
                ringStylesRef.current.borderBottomLeftRadius + ringOffsetPx + ringWidthPx
            }px`;
        } else {
            ringRef.current.style.borderBottomLeftRadius =
                ringStylesRef.current.borderBottomLeftRadius;
        }

        if (typeof ringStylesRef.current.borderBottomRightRadius === "number") {
            ringRef.current.style.borderBottomRightRadius = `${
                ringStylesRef.current.borderBottomRightRadius + ringOffsetPx + ringWidthPx
            }px`;
        } else {
            ringRef.current.style.borderBottomRightRadius =
                ringStylesRef.current.borderBottomRightRadius;
        }
    }, [ringStylesRef]);

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
