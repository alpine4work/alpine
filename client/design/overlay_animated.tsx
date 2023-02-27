import {Ref, forwardRef, useEffect, useRef, useState} from "react";
import {Overlay, OverlayProps, OverlayRef} from "~/client/design/overlay";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
} from "~/shared/styles/styles";

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
        overlay: originalOverlay,
        ...props
    }: OverlayProps & {
        /**
         * Should disable the animation. The `visible` prop will be what's passed to
         * the underlying overlay component.
         *
         * Defaults to `false`.
         */
        disableAnimation?: boolean;
    },
    ref: Ref<OverlayRef>,
) {
    const [_state, setState] = useState(initialOverlayAnimatedState);

    let state: OverlayAnimatedState;

    if (disableAnimation) {
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

    useEffect(() => {
        if (state.isAnimating) {
            const timeoutId = setTimeout(
                () => {
                    setState(prevState => ({...prevState, isAnimating: false}));
                },
                state.isVisible
                    ? overlayFadeInAnimationDurationMs
                    : overlayFadeOutAnimationDurationMs,
            );
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [state.isAnimating, state.isVisible]);

    const overlayRef = useRef<HTMLElement>(null);

    // We need this intermediate `<div>` because our animation uses CSS `translate`
    const overlay = (
        <div className={overlayAnimateContainerClassName}>
            {useElementWithRef(originalOverlay, overlayRef)}
        </div>
    );

    // It's ok to ignore the server-side warning since overlays are not visible in
    // the server-side render.
    useLayoutEffectWithoutServerSideWarning(() => {
        const animateClassName = state.isAnimating
            ? state.isVisible
                ? overlayAnimateFadeInClassName
                : overlayAnimateFadeOutClassName
            : null;

        if (animateClassName) {
            assert(overlayRef.current);
            const overlayElement = overlayRef.current;
            overlayElement.classList.add(animateClassName);
            return () => overlayElement.classList.remove(animateClassName);
        }
    }, [state.isAnimating, state.isVisible]);

    return (
        <Overlay
            {...props}
            ref={ref}
            isVisible={state.isVisible || state.isAnimating}
            overlay={overlay}
        />
    );
}
