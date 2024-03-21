import {Ref, forwardRef, useEffect, useRef, useState} from "react";
import {Overlay, OverlayProps, OverlayRef} from "~/client/design/overlay.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
} from "~/shared/styles/styles.js";

const OverlayAnimatedForwardRef = forwardRef(OverlayAnimated);
export {OverlayAnimatedForwardRef as OverlayAnimated};

type OverlayAnimatedState = {
    readonly isVisible: boolean;
    readonly isAnimating: boolean;
};

const initialOverlayAnimatedState: OverlayAnimatedState = {
    isVisible: false,
    isAnimating: false,
};

/**
 * Same as the `<Overlay>` component but we animate the overlay in and out when
 * the `visible` prop changes.
 *
 * So when you pass in `visible` false the overlay may still be rendered for a
 * couple milliseconds. You may use `disableAnimation` on this component if you
 * want the original `<Overlay>` behavior.
 */
function OverlayAnimated(
    {
        isVisible = false,
        disableAnimation = false,
        disableAnimationIn = false,
        disableAnimationOut = false,
        overlay: originalOverlay,
        onActuallyVisibleChange,
        ...props
    }: OverlayProps & {
        /**
         * Should disable the animation. The `visible` prop will be what's passed to
         * the underlying overlay component.
         *
         * Defaults to `false`.
         */
        disableAnimation?: boolean;

        /**
         * `disableAnimation` but only disables the fade in animation.
         *
         * Defaults to `false`.
         */
        disableAnimationIn?: boolean;

        /**
         * `disableAnimation` but only disables the fade out animation.
         *
         * Defaults to `false`.
         */
        disableAnimationOut?: boolean;

        /**
         * Called when whether the overlay is actually hidden/visible changes. If the
         * `isVisible` prop is false then we may still be visible until our overlay's
         * animation is finished.
         */
        onActuallyVisibleChange?: (isActuallyVisible: boolean) => void;
    },
    ref: Ref<OverlayRef>,
) {
    const [_state, setState] = useState(initialOverlayAnimatedState);

    let state: OverlayAnimatedState;

    if (
        disableAnimation ||
        (disableAnimationIn && isVisible) ||
        (disableAnimationOut && !isVisible)
    ) {
        const disabledState: OverlayAnimatedState = {
            isVisible,
            isAnimating: false,
        };
        state = !isDeepEqual(_state, disabledState) ? disabledState : _state;
    } else if (isVisible !== _state.isVisible) {
        state = {
            isVisible,
            isAnimating: true,
        };
    } else {
        state = _state;
    }

    if (state !== _state) setState(state);

    const overlayRef = useRef<HTMLElement>(null);

    // We need this intermediate `<div>` because our animation uses CSS `translate`
    const overlay = (
        <div className={overlayAnimateContainerClassName}>
            {useElementWithRef(originalOverlay, overlayRef)}
        </div>
    );

    useEffect(() => {
        if (!state.isAnimating) return;

        const overlayElement = assertExists(overlayRef.current);

        let isCancelled = false;
        let timeout: Timeout | null = null;
        let animateClassName: string | null = null;

        // NOTE(calebmer): Without this `requestAnimationFrame()` the animation is
        // [quite choppy on iOS Safari][1]. I have no idea why adding this helps.
        // My best guess is the animation is being blocked by some JavaScript code?
        //
        // [1]: https://gist.github.com/calebmer/ab71d37aa8ebf3866043882ad17d32ca
        requestAnimationFrame(() => {
            if (isCancelled) return;

            animateClassName = state.isVisible
                ? overlayAnimateFadeInClassName
                : overlayAnimateFadeOutClassName;

            overlayElement.classList.add(animateClassName);

            timeout = createTimeout(
                () => setState(prevState => ({...prevState, isAnimating: false})),
                state.isVisible
                    ? overlayFadeInAnimationDurationMs
                    : overlayFadeOutAnimationDurationMs,
            );
        });

        return () => {
            isCancelled = true;
            timeout?.clear();
            if (animateClassName) overlayElement.classList.remove(animateClassName);
        };
    }, [state.isAnimating, state.isVisible]);

    const isActuallyVisible = state.isVisible || state.isAnimating;

    const wasActuallyVisibleRef = useRef(isActuallyVisible);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (wasActuallyVisibleRef.current !== isActuallyVisible) {
            wasActuallyVisibleRef.current = isActuallyVisible;
            onActuallyVisibleChange?.(isActuallyVisible);
        }
    });

    return <Overlay {...props} ref={ref} isVisible={isActuallyVisible} overlay={overlay} />;
}
