import {RefCallback, useCallback, useEffect, useRef, useState} from "react";
import {useLifecycleRef} from "~/client/web/helpers/refs/use_lifecycle_ref.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * A better implementation of `react-aria`'s `useHover()` that follows our
 * reusable component conventions (lifecycle refs). It's better in that it
 * supports the mouse moving into an overlay as cancelling the hover.
 */
// TODO(calebmer): I think this is better than `react-aria`'s `useHover()` on
// every dimension. We should replace our use of `useHover()` with this hook.
export function useHoverWithOverlaySupport(): [
    isHovered: boolean,
    hoverRef: RefCallback<HTMLElement>,
] {
    const elementRef = useRef<HTMLElement | null>(null);
    const [isHovered, setIsHovered] = useState(false);

    const lifecycleRef = useCallback((element: HTMLElement) => {
        elementRef.current = element;

        const handlePointerEnter = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;

            setIsHovered(true);
        };

        const handlePointerLeave = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;

            setIsHovered(false);
        };

        element.addEventListener("pointerenter", handlePointerEnter);
        element.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            element.removeEventListener("pointerenter", handlePointerEnter);
            element.removeEventListener("pointerleave", handlePointerLeave);

            elementRef.current = null;
            setIsHovered(false);
        };
    }, []);

    // If we have received a `pointerenter` event, then listen for `pointerenter`
    // events on `document` which will happen if the mouse enters an element that
    // occludes our own. If the pointer enters an occluding element we should set
    // `isHovered` to false.
    useEffect(() => {
        if (!isHovered) return;

        const element = assertExists(elementRef.current);

        const handleDocumentPointerEnter = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") return;

            if (!event.target || event.target instanceof Node) {
                setIsHovered(element.contains(event.target));
            }
        };

        document.addEventListener("pointerenter", handleDocumentPointerEnter);
        return () => {
            document.removeEventListener("pointerenter", handleDocumentPointerEnter);
        };
    }, [isHovered]);

    return [isHovered, useLifecycleRef(lifecycleRef)];
}
