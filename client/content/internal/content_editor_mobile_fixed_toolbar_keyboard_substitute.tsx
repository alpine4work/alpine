import {animate} from "motion";
import {X} from "phosphor-react";
import {Ref, forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {nativeMobileBottomBarKeyboardSubstituteHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {easeOutCubic, parseBezier} from "~/shared/design/easing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type ContentEditorMobileKeyboardSubstituteRef = {
    closeWithAnimation(): void;
};

const ContentEditorMobileKeyboardSubstituteForwardRef = forwardRef(
    ContentEditorMobileKeyboardSubstitute,
);
export {ContentEditorMobileKeyboardSubstituteForwardRef as ContentEditorMobileKeyboardSubstitute};

function ContentEditorMobileKeyboardSubstitute(
    {onClose}: {onClose: () => void},
    ref: Ref<ContentEditorMobileKeyboardSubstituteRef>,
) {
    const substituteRef = useRef<HTMLDivElement>(null);

    const [isClosing, setIsClosing] = useState(false);

    const hasAnimatedOpenedRef = useRef(false);
    useEffect(() => {
        if (hasAnimatedOpenedRef.current) return;
        hasAnimatedOpenedRef.current = true;

        const substituteElement = assertExists(substituteRef.current);

        animate(
            substituteElement,
            {y: [0, -substituteElement.getBoundingClientRect().height]},
            {
                duration: 0.25,
                easing: parseBezier(easeOutCubic.cubicBezier),
                // Make sure we use hardware acceleration for this animation in WebKit. By
                // default `motion` turns it off.
                // https://motion.dev/guides/performance#webkits-exceptions
                allowWebkitAcceleration: true,
            },
        );
    }, []);

    const hasAnimatedClosedRef = useRef(false);
    useEffect(() => {
        if (hasAnimatedClosedRef.current) return;
        if (!isClosing) return;
        hasAnimatedClosedRef.current = true;

        const substituteElement = assertExists(substituteRef.current);

        const animation = animate(
            substituteElement,
            {y: [-substituteElement.getBoundingClientRect().height, 0]},
            {
                duration: 0.25,
                easing: parseBezier(easeOutCubic.cubicBezier),
                // Make sure we use hardware acceleration for this animation in WebKit. By
                // default `motion` turns it off.
                // https://motion.dev/guides/performance#webkits-exceptions
                allowWebkitAcceleration: true,
            },
        );

        animation.finished.finally(onClose);
    });

    useImperativeHandle(
        ref,
        () => ({
            closeWithAnimation: () => {
                setIsClosing(true);
            },
        }),
        [],
    );

    return (
        <Box
            ref={substituteRef}
            position="fixed"
            // Render above everything on the page including toolbar.
            zIndex="70"
            left="0"
            right="0"
            backgroundColor="grey-5"
            borderTopRadius="xl"
            boxShadow="elevation-40"
            style={{
                top: `var(--space-outlet-height, 100svh)`,
                paddingBottom: "var(--window-safe-area-inset-bottom, 0px)",
            }}
            onPointerDownCapture={event => {
                // Tapping on the toolbar shouldn't unfocus the content editor since that will
                // remove the selection and hide the keyboard.
                event.preventDefault();
            }}
        >
            <Box height={nativeMobileBottomBarKeyboardSubstituteHeight}>
                <Box position="absolute" top="2" right="2">
                    <IconButton
                        // Tapping on the button shouldn't unfocus the content editor. The button also
                        // isn't focusable.
                        isFocusable={false}
                        variant="quiet-above-grey-5-background"
                        size="md"
                        description="Close"
                        withoutTooltip={true}
                        onPress={() => setIsClosing(true)}
                    >
                        <X />
                    </IconButton>
                </Box>
                <Box height="10">Test 1</Box>
                <Box height="10">Test 2</Box>
                <Box height="10">Test 3</Box>
            </Box>
        </Box>
    );
}
