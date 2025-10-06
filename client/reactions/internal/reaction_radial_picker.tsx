import {AnimationPlaybackControls, animate, spring} from "motion";
import {Memo, Ref, forwardRef, useEffect, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {reactionRadialPickerSize} from "~/client/styles/reaction_shared_styles.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";

const reactionRadialPickerInitialScale = 0.25;

export type ReactionRadialPickerRef = {
    animateOut(): AnimationPlaybackControls;
};

const ReactionRadialPickerForwardRef = forwardRef(ReactionRadialPicker);
export {ReactionRadialPickerForwardRef as ReactionRadialPicker};

function ReactionRadialPicker(
    {isVisible, onCloseWithAnimation}: {isVisible: boolean; onCloseWithAnimation: Memo<() => void>},
    ref: Ref<ReactionRadialPickerRef>,
) {
    const circleContainerRef = useRef<HTMLDivElement>(null);
    const circleRef = useRef<HTMLDivElement>(null);

    const hasInitiallyMountedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const circleContainerElement = assertExists(circleContainerRef.current);

        void animate(
            circleContainerElement,
            {
                opacity: [0, 1],
                scale: [reactionRadialPickerInitialScale, 1],
            },
            {
                type: spring,
                stiffness: 350,
                damping: 22,
            },
        );
    }, []);

    useImperativeHandle(
        ref,
        () => ({
            animateOut: () => {
                const circleContainerElement = assertExists(circleContainerRef.current);

                return animate(
                    circleContainerElement,
                    {
                        opacity: 0,
                        scale: reactionRadialPickerInitialScale,
                    },
                    {
                        ease: "easeOut",
                        duration: 0.2,
                    },
                );
            },
        }),
        [],
    );

    useEffect(() => {
        // If we're closing the radial picker, don't update the transform based on the
        // pointer position.
        if (!isVisible) return;

        const circleElement = assertExists(circleRef.current);
        const circleContainerElement = assertExists(circleContainerRef.current);

        const handlePointerMove = (event: PointerEvent) => {
            const spacingScale = getSpacingScaleWithoutListening();

            const circleContainerRect = circleContainerElement.getBoundingClientRect();
            const circleContainerCenterX = circleContainerRect.left + circleContainerRect.width / 2;
            const circleContainerCenterY = circleContainerRect.top + circleContainerRect.height / 2;

            const pointerVector = new Vector2(
                event.clientX - circleContainerCenterX,
                event.clientY - circleContainerCenterY,
            );

            const maxTransformMagnitude = convertRemLengthToPx("12", spacingScale);
            const inflectionPointerMagnitude = convertRemLengthToPx("64", spacingScale);

            const transformMagnitude =
                maxTransformMagnitude *
                (pointerVector.magnitude / (pointerVector.magnitude + inflectionPointerMagnitude));

            const transformVector = Vector2.fromPolar(pointerVector.angle, transformMagnitude);

            circleElement.style.transform = `translate(${transformVector.x}px, ${transformVector.y}px)`;
        };

        // Called when the pointer leaves the document.
        const handlePointerLeave = () => {
            onCloseWithAnimation();
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerleave", handlePointerLeave);
        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointerleave", handlePointerLeave);
        };
    }, [isVisible, onCloseWithAnimation]);

    return (
        <Box
            ref={circleContainerRef}
            pointerEvents="none"
            width={reactionRadialPickerSize}
            height={reactionRadialPickerSize}
        >
            <Box
                ref={circleRef}
                pointerEvents="auto"
                width={reactionRadialPickerSize}
                height={reactionRadialPickerSize}
                backgroundColor="grey-0"
                boxShadow="elevation-30"
                overflow="hidden"
                borderRadius="full"
            >
                <Box width="full" height="full" display="flex" flexDirection="column" gap="0.5">
                    <Box flexGrow="1" width="full" display="flex" flexDirection="row" gap="0.5">
                        <Box flexGrow="1" height="full" backgroundColor="grey-5" />
                        <Box flexGrow="1" height="full" backgroundColor="grey-5" />
                    </Box>
                    <Box flexGrow="1" width="full" display="flex" flexDirection="row" gap="0.5">
                        <Box flexGrow="1" height="full" backgroundColor="grey-5" />
                        <Box flexGrow="1" height="full" backgroundColor="grey-5" />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
