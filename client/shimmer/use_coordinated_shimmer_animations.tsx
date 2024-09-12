import {useRef} from "react";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {pulseAnimationClassName} from "~/client/styles/styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function useCoordinatedShimmerAnimations({isDisabled = false}: {isDisabled?: boolean} = {}) {
    const isMobile = useIsMobile();
    const containerRef = useRef<HTMLDivElement>(null);

    // Set shimmer start times to the same value. That way shimmers rendered at
    // different times will have the same animation timeline.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isDisabled) return;

        // Re-coordinate whenever `isMobile` changes.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        isMobile;

        const shimmerElements = assertExists(containerRef.current).getElementsByClassName(
            pulseAnimationClassName,
        );
        for (const shimmerElement of shimmerElements) {
            for (const animation of shimmerElement.getAnimations()) {
                animation.startTime = 0;
            }
        }
    }, [isDisabled, isMobile]);

    return containerRef;
}
