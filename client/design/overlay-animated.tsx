import {Ref, forwardRef, useEffect, useRef, useState} from "react";
import {useElementWithRef} from "~/client/design/helpers/use-element-with-ref";
import {Overlay, OverlayProps, OverlayRef} from "~/client/design/overlay";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use-layout-effect-without-server-side-warning";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeAnimationDurationMs,
} from "~/shared/styles/styles";

const OverlayAnimatedForwardRef = forwardRef(OverlayAnimated);
export {OverlayAnimatedForwardRef as OverlayAnimated};

type OverlayAnimatedState = {
    readonly visible: boolean;
    readonly animating: boolean;
};

const initialOverlayAnimatedState: OverlayAnimatedState = {
    visible: false,
    animating: false,
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
        visible = false,
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
            visible,
            animating: false,
        };
        state = !isDeepEqual(_state, disabledState) ? disabledState : _state;
    } else if (visible !== _state.visible) {
        state = {
            visible,
            animating: true,
        };
    } else {
        state = _state;
    }

    if (state !== _state) setState(state);

    useEffect(() => {
        if (state.animating) {
            const timeoutId = setTimeout(() => {
                setState(prevState => ({...prevState, animating: false}));
            }, overlayFadeAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [state.animating]);

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
        const animateClassName = state.animating
            ? state.visible
                ? overlayAnimateFadeInClassName
                : overlayAnimateFadeOutClassName
            : null;

        if (animateClassName) {
            assert(overlayRef.current);
            const overlayElement = overlayRef.current;
            overlayElement.classList.add(animateClassName);
            return () => overlayElement.classList.remove(animateClassName);
        }
    }, [state.animating, state.visible]);

    return (
        <Overlay
            {...props}
            ref={ref}
            visible={state.visible || state.animating}
            overlay={overlay}
        />
    );
}
