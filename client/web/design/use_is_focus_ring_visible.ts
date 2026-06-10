import {getInteractionModality} from "@react-aria/interactions";
import {RefCallback, useCallback, useRef, useState} from "react";
import {flushSyncIfNotRendering} from "~/client/web/helpers/flush_sync_if_not_rendering.js";
import {useLifecycleRef} from "~/client/web/helpers/refs/use_lifecycle_ref.js";

let currentActiveElement: HTMLElement | null = null;

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

    const hasInitiallyMountedForTargetElementRef = useRef<HTMLElement | null>(null);

    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            // Make sure `currentActiveElement` still exists in the DOM before using it.
            if (!document.body.contains(currentActiveElement)) currentActiveElement = null;

            if (shouldIgnoreFocusEvents) {
                if (currentActiveElement === targetElement) currentActiveElement = null;
                setIsActive(false);
                return;
            }

            const isActive = (focusedElement: Element | null) => {
                // If there is an element focused...
                if (!focusedElement) return false;

                // And we don't have a child element with a focus ring...
                if (
                    currentActiveElement &&
                    targetElement !== currentActiveElement &&
                    targetElement.contains(currentActiveElement)
                ) {
                    return false;
                }

                // Either:
                //
                // 1. We are the focused element
                // 2. A child is focused (but doesn't have a focus ring) and
                //    `isVisibleWhenFocusWithin` is true
                const isFocused =
                    focusedElement === targetElement ||
                    (isVisibleWhenFocusWithin &&
                        targetElement.contains(focusedElement) &&
                        (!currentActiveElement || currentActiveElement === targetElement));

                if (!isFocused) return false;

                // Only show the focus ring when we are in a keyboard interaction modality. (Unless
                // otherwise specified.) We cache whether focus is visible instead of relying on a
                // prop since if the interaction modality changes from keyboard to mouse we'd like
                // to keep the ring.
                return isVisibleFromAnyFocus || getInteractionModality() !== "pointer";
            };

            let isFocused =
                // If we are initially mounting, don't consider the element to be focused so
                // `update()` actually updates our state.
                hasInitiallyMountedForTargetElementRef.current === targetElement &&
                (document.activeElement === targetElement ||
                    (isVisibleWhenFocusWithin &&
                        targetElement.contains(document.activeElement) &&
                        (!currentActiveElement || currentActiveElement === targetElement)));

            const update = (event?: FocusEvent) => {
                // Make sure `currentActiveElement` still exists in the DOM before using it.
                if (!document.body.contains(currentActiveElement)) currentActiveElement = null;

                const focusedElement =
                    event?.type === "focusout"
                        ? (event.relatedTarget as Element | null)
                        : document.activeElement;

                // If focus is moving within our target element then ignore `focusout` events.
                // We'll get a `focusin` event right after we can handle. This fixes an issue where
                // the parent renders a focus ring when navigating from one element within it to
                // another (both of which have `<FocusRing>`s of their own). We should be able to
                // detect the one correct active element and only render a single focus ring but we
                // end up with two.
                //
                // Video reproducing the issue:
                // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/7q5swjv2f8f5bcfpx2kz4cj1ag
                if (event?.type === "focusout" && targetElement.contains(focusedElement)) return;

                const nextIsFocused =
                    focusedElement === targetElement ||
                    (isVisibleWhenFocusWithin &&
                        targetElement.contains(focusedElement) &&
                        // Don't consider ourselves focused if a child element has the focus ring.
                        //
                        // This way the focus ring moves properly in inputs like our chat account picker
                        // work when tabbing between the text input and selected accounts.
                        (!currentActiveElement || currentActiveElement === targetElement));

                // Only update our active state if focus is moving in or out of the target element.
                // Not if focus is moving within sub-elements of the target element.
                //
                // This way if we have an input (like a date input) comprised of multiple focusable
                // segments, clicking in then keyboard navigating doesn't show the focus ring.
                if (isFocused !== nextIsFocused) {
                    isFocused = nextIsFocused;

                    // Immediately re-render the focus ring. That way if we have any state changing the
                    // visuals of an element in `onFocus` or `onBlur` we don't have a tear with the
                    // focus ring in a weird state.
                    flushSyncIfNotRendering(() => {
                        if (isActive(focusedElement)) {
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
            // This is necessary for elements that are keyboard focused on mount. For example,
            // try editing a comment with the keyboard. It should get a focus ring.
            //
            // However, we don't want to update the focus state on prop change. For example,
            // try clicking into an account picker (focus is not visible, no ring) then using
            // arrow keys to select an account (account should get ring) then hitting enter to
            // select the account (focus returned to text input which should not have ring, it
            // stayed focused and maintained its inactive focus ring state).
            if (hasInitiallyMountedForTargetElementRef.current !== targetElement) {
                hasInitiallyMountedForTargetElementRef.current = targetElement;
                update();
            }

            // Use `focusin`/`focusout` instead of `focus`/`blur` because the former bubbles.
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

    const hasInitiallyMountedForElementRef = useRef<HTMLElement | null>(null);

    const targetLifecycleRef = useCallback((targetElement: HTMLElement) => {
        const update = () => {
            // Immediately re-render since focus rings are rendered immediately.
            flushSyncIfNotRendering(() => {
                setIsChildFocusRingVisible(targetElement.contains(currentActiveElement));
            });
        };

        // Update our focus state on initial mount.
        if (hasInitiallyMountedForElementRef.current !== targetElement) {
            hasInitiallyMountedForElementRef.current = targetElement;
            update();
        }

        // Use `focusin`/`focusout` instead of `focus`/`blur` because the former bubbles.
        targetElement.addEventListener("focusin", update);
        targetElement.addEventListener("focusout", update);
        return () => {
            targetElement.removeEventListener("focusin", update);
            targetElement.removeEventListener("focusout", update);
        };
    }, []);

    return [isChildFocusRingVisible, useLifecycleRef(targetLifecycleRef)];
}
