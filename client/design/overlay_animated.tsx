import {AnimationControls, animate} from "motion";
import {Ref, forwardRef, useRef, useState} from "react";
import {Overlay, OverlayProps, OverlayRef} from "~/client/design/overlay.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeInOutTimingFunction,
    overlayFadeOutAnimationDurationMs,
} from "~/client/styles/styles.js";
import {parseCubicBezier} from "~/shared/design/easing.js";
import {spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {quote} from "~/shared/helpers/string/quote.js";

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

    const overlayContainerRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLElement>(null);

    // We need this intermediate `<div>` because our animation uses CSS `translate`
    // but `<Overlay>` also sets CSS `translate` to position the overlay. So
    // `<Overlay>` will translate this intermediate `<div>` and we'll animate the
    // child.
    const overlay = (
        <div ref={overlayContainerRef} className={overlayAnimateContainerClassName}>
            {useElementWithRef(originalOverlay, overlayRef)}
        </div>
    );

    const isActuallyVisible = state.isVisible || state.isAnimating;

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isAnimating) return;
        if (!state.isVisible) return;

        const overlayElement = assertExists(overlayRef.current);

        overlayElement.classList.add(overlayAnimateFadeInClassName);

        const timeout = createTimeout(() => {
            setState(prevState => ({...prevState, isAnimating: false}));
        }, overlayFadeInAnimationDurationMs);

        return () => {
            overlayElement.classList.remove(overlayAnimateFadeInClassName);
            timeout.clear();
        };
    }, [isActuallyVisible, state.isAnimating, state.isVisible]);

    // NOTE(calebmer, #mobile-webkit-weirdness): Implement fade out animation with
    // the `motion` package. I've observed CSS class based animations randomly stop
    // working on mobile WebKit after ~3min of app use. Implementing the animation
    // with `motion` fixes the issue. I have no idea why it fixes the issue, but it
    // does.
    //
    // Adding `allowWebkitAcceleration: true` breaks the animation again.
    // Interestingly translation will work but the opacity change won't work.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isAnimating) return;
        if (state.isVisible) return;

        const overlayContainerElement = assertExists(overlayContainerRef.current);
        const overlayElement = assertExists(overlayRef.current);

        const popperPlacement = overlayContainerElement.dataset.popperPlacement;

        let animationKeyframes: {
            opacity: [number, number];
            x?: [string, string];
            y?: [string, string];
        };

        if (popperPlacement?.startsWith("top")) {
            animationKeyframes = {
                opacity: [1, 0],
                y: ["0rem", `-${spacing["1"]}`],
            };
        } else if (popperPlacement?.startsWith("bottom")) {
            animationKeyframes = {
                opacity: [1, 0],
                y: ["0rem", spacing["1"]],
            };
        } else if (popperPlacement?.startsWith("left")) {
            animationKeyframes = {
                opacity: [1, 0],
                x: ["0rem", `-${spacing["1"]}`],
            };
        } else if (popperPlacement?.startsWith("right")) {
            animationKeyframes = {
                opacity: [1, 0],
                x: ["0rem", spacing["1"]],
            };
        } else {
            // eslint-disable-next-line no-console
            console.warn(
                quote`Unexpected \`data-popper-placement\` attribute: ${popperPlacement ?? null}`,
            );

            const timeout = createTimeout(() => {
                setState(prevState => ({...prevState, isAnimating: false}));
            }, overlayFadeOutAnimationDurationMs);

            return () => {
                timeout.clear();
            };
        }

        let isCancelled = false;
        let animation: AnimationControls | undefined;

        // NOTE(calebmer): Without this `requestAnimationFrame()` the animation is
        // [quite choppy on iOS Safari][1]. I have no idea why adding this helps.
        // My best guess is the animation is being blocked by some JavaScript code?
        //
        // [1]: https://gist.github.com/calebmer/ab71d37aa8ebf3866043882ad17d32ca
        requestAnimationFrame(() => {
            if (isCancelled) return;

            animation = animate(overlayElement, animationKeyframes, {
                duration: overlayFadeOutAnimationDurationMs / 1000,
                easing: parseCubicBezier(overlayFadeInOutTimingFunction),
            });

            void animation.finished.finally(() => {
                if (isCancelled) return;
                setState(prevState => ({...prevState, isAnimating: false}));
            });
        });

        return () => {
            isCancelled = true;
            animation?.finish();
        };
    }, [state.isAnimating, state.isVisible]);

    const wasActuallyVisibleRef = useRef(isActuallyVisible);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (wasActuallyVisibleRef.current !== isActuallyVisible) {
            wasActuallyVisibleRef.current = isActuallyVisible;
            onActuallyVisibleChange?.(isActuallyVisible);
        }
    });

    return <Overlay {...props} ref={ref} isVisible={isActuallyVisible} overlay={overlay} />;
}
