import {animate} from "motion";
import {
    Code,
    IconContext,
    Link as LinkIcon,
    ListBullets,
    ListChecks,
    ListNumbers,
    Palette,
    TextBolder,
    TextHOne,
    TextHThree,
    TextHTwo,
    TextItalic,
    TextStrikethrough,
    X,
} from "phosphor-react";
import {ReactNode, Ref, forwardRef, useEffect, useImperativeHandle, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box, BoxProps} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {nativeMobileBottomBarKeyboardSubstituteHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {easeOutCubic, parseBezier} from "~/shared/design/easing.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {colorSchemeVars, contentSchemaStyles} from "~/shared/styles/styles.js";

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
            backgroundColor="grey-0"
            borderTopRadius="xl"
            boxShadow="elevation-40-from-bottom"
            overflow="hidden"
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
            <Box
                height={nativeMobileBottomBarKeyboardSubstituteHeight}
                display="flex"
                flexDirection="column"
                paddingBottom="2"
            >
                <Box position="absolute" top="1" right="1">
                    <IconButton
                        // Tapping on the button shouldn't unfocus the content editor. The button also
                        // isn't focusable.
                        isFocusable={false}
                        size="md"
                        description="Close"
                        withoutTooltip={true}
                        onPress={() => setIsClosing(true)}
                    >
                        <X />
                    </IconButton>
                </Box>
                <Box
                    flexShrink="0"
                    paddingX="3"
                    height="8"
                    display="flex"
                    alignItems="center"
                    fontSize="50"
                    color="grey-60"
                >
                    Styles
                </Box>
                <Box
                    flexGrow="1"
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, 1fr)",
                        gridTemplateRows: "repeat(6, 1fr)",
                        gridAutoFlow: "column",
                        // Simple border down the middle with gradient. Solution inspired by:
                        // https://stackoverflow.com/a/61678228/1568890
                        background: `linear-gradient(${colorSchemeVars["grey-5"]}, ${colorSchemeVars["grey-5"]}) center/1px 100% no-repeat`,
                    }}
                >
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextBolder />}
                        label="Bold"
                        labelProps={{fontStyle: "extra-bold"}}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextItalic />}
                        label="Italic"
                        labelProps={{className: contentSchemaStyles.italicClassName}}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<LinkIcon />}
                        label="Link"
                        labelProps={{
                            className: contentSchemaStyles.linkClassName,
                            style: {color: "inherit"},
                        }}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<Palette />}
                        label="Highlight"
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextStrikethrough />}
                        label="Strikethrough"
                        labelProps={{className: contentSchemaStyles.strikeClassName}}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<Code />}
                        label="Code"
                        labelProps={{className: contentSchemaStyles.codeClassName}}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextHOne />}
                        label="Heading 1"
                        labelProps={{
                            fontStyle: "bold",
                            style: {
                                transformOrigin: "left center",
                                transform: "scale(1.2)",
                            },
                        }}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextHTwo />}
                        label="Heading 2"
                        labelProps={{
                            fontStyle: "bold",
                            style: {
                                transformOrigin: "left center",
                                transform: "scale(1.1)",
                            },
                        }}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextHThree />}
                        label="Heading 3"
                        labelProps={{fontStyle: "bold"}}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<ListBullets />}
                        label="Bullet list"
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<ListNumbers />}
                        label="Number list"
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<ListChecks />}
                        label="Check list"
                    />
                </Box>
            </Box>
        </Box>
    );
}

function ContentEditorMobileKeyboardSubstituteButton({
    icon,
    label,
    labelProps,
}: {
    icon: ReactNode;
    label: string;
    labelProps?: BoxProps;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({});

    return (
        <Box paddingX="2" {...mergeProps(hoverProps, pressProps)}>
            <Box
                width="full"
                height="full"
                paddingX="3"
                color="grey-text"
                fontSize="100"
                display="flex"
                alignItems="center"
                gap="2.5"
                borderRadius="md"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
            >
                <IconContext.Provider
                    value={{color: colorSchemeVars["grey-70"], size: spacing["4"]}}
                >
                    {icon}
                </IconContext.Provider>
                <Box {...labelProps}>{label}</Box>
            </Box>
        </Box>
    );
}
