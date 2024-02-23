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
import {Command, EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    ReactNode,
    Ref,
    RefObject,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {
    areAllNodesBlockType,
    areAllNodesListItemType,
    createToggleBlockTypeCommand,
    createToggleListItemsCommand,
    createToggleMarkCommand,
    getMarksSpanningAcrossEntireRange,
} from "~/client/content/internal/content_editor_prosemirror_helpers.js";
import {Box, BoxProps} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {nativeMobileBottomBarKeyboardSubstituteHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
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
    {
        state,
        viewRef,
        onClose,
    }: {
        state: EditorState & {schema: ContentProsemirrorSchema};
        viewRef: RefObject<EditorView | null>;
        onClose: () => void;
    },
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

    const {isBoldActive, isItalicActive, isStrikeActive, isCodeActive} = useMemo(() => {
        const marks = getMarksSpanningAcrossEntireRange(state.doc, state.selection);

        const boldMark = state.schema.mark("bold");
        const italicMark = state.schema.mark("italic");
        const strikeMark = state.schema.mark("strike");
        const codeMark = state.schema.mark("code");

        return {
            isBoldActive:
                boldMark.isInSet(marks) ||
                (!!state.storedMarks && boldMark.isInSet(state.storedMarks)),
            isItalicActive:
                italicMark.isInSet(marks) ||
                (!!state.storedMarks && italicMark.isInSet(state.storedMarks)),
            isStrikeActive:
                strikeMark.isInSet(marks) ||
                (!!state.storedMarks && strikeMark.isInSet(state.storedMarks)),
            isCodeActive:
                codeMark.isInSet(marks) ||
                (!!state.storedMarks && codeMark.isInSet(state.storedMarks)),
        };
    }, [state.doc, state.schema, state.selection, state.storedMarks]);

    const isUnorderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(
                state.doc,
                state.selection,
                state.schema.nodes.unorderedListItem,
            ),
        [state.doc, state.schema.nodes.unorderedListItem, state.selection],
    );

    const isOrderedListItemActive = useMemo(
        () =>
            areAllNodesListItemType(state.doc, state.selection, state.schema.nodes.orderedListItem),
        [state.doc, state.schema.nodes.orderedListItem, state.selection],
    );

    const isCheckListItemActive = useMemo(
        () =>
            !!state.schema.nodes.checkListItem &&
            areAllNodesListItemType(state.doc, state.selection, state.schema.nodes.checkListItem),
        [state.doc, state.schema.nodes.checkListItem, state.selection],
    );

    const isHeadingLevel1Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, state.schema.nodes.heading, {
                level: 1,
            }),
        [state.doc, state.schema.nodes.heading, state.selection],
    );

    const isHeadingLevel2Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, state.schema.nodes.heading, {
                level: 2,
            }),
        [state.doc, state.schema.nodes.heading, state.selection],
    );

    const isHeadingLevel3Active = useMemo(
        () =>
            !!state.schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, state.schema.nodes.heading, {
                level: 3,
            }),
        [state.doc, state.schema.nodes.heading, state.selection],
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
                display="flex"
                flexDirection="column"
                paddingBottom="2"
                style={{height: nativeMobileBottomBarKeyboardSubstituteHeight}}
            >
                <Box position="absolute" top="2" right="2">
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
                    paddingX="4"
                    height="10"
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
                        isActive={isBoldActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleMarkCommand(state.schema.mark("bold")),
                        )}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextItalic />}
                        label="Italic"
                        labelProps={{className: contentSchemaStyles.italicClassName}}
                        isActive={isItalicActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleMarkCommand(state.schema.mark("italic")),
                        )}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<LinkIcon />}
                        label="Link"
                        labelProps={{
                            className: contentSchemaStyles.linkClassName,
                            style: {color: "inherit"},
                        }}
                        isActive={false}
                        onPress={() => {
                            // NOCOMMIT: Implement
                        }}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<Palette />}
                        label="Highlight"
                        isActive={false}
                        onPress={() => {
                            // NOCOMMIT: Implement
                        }}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<TextStrikethrough />}
                        label="Strikethrough"
                        labelProps={{className: contentSchemaStyles.strikeClassName}}
                        isActive={isStrikeActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleMarkCommand(state.schema.mark("strike")),
                        )}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<Code />}
                        label="Code"
                        labelProps={{className: contentSchemaStyles.codeClassName}}
                        isActive={isCodeActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleMarkCommand(state.schema.mark("code")),
                        )}
                    />
                    {state.schema.nodes.heading && (
                        <>
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
                                isActive={isHeadingLevel1Active}
                                onPress={fromCommand(
                                    viewRef,
                                    createToggleBlockTypeCommand(state.schema.nodes.heading, {
                                        level: 1,
                                    }),
                                )}
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
                                isActive={isHeadingLevel2Active}
                                onPress={fromCommand(
                                    viewRef,
                                    createToggleBlockTypeCommand(state.schema.nodes.heading, {
                                        level: 2,
                                    }),
                                )}
                            />
                            <ContentEditorMobileKeyboardSubstituteButton
                                icon={<TextHThree />}
                                label="Heading 3"
                                labelProps={{fontStyle: "bold"}}
                                isActive={isHeadingLevel3Active}
                                onPress={fromCommand(
                                    viewRef,
                                    createToggleBlockTypeCommand(state.schema.nodes.heading, {
                                        level: 3,
                                    }),
                                )}
                            />
                        </>
                    )}
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<ListBullets />}
                        label="Bullet list"
                        isActive={isUnorderedListItemActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleListItemsCommand(state.schema.nodes.unorderedListItem),
                        )}
                    />
                    <ContentEditorMobileKeyboardSubstituteButton
                        icon={<ListNumbers />}
                        label="Number list"
                        isActive={isOrderedListItemActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleListItemsCommand(state.schema.nodes.orderedListItem),
                        )}
                    />
                    {state.schema.nodes.checkListItem && (
                        <ContentEditorMobileKeyboardSubstituteButton
                            icon={<ListChecks />}
                            label="Check list"
                            isActive={isCheckListItemActive}
                            onPress={fromCommand(
                                viewRef,
                                createToggleListItemsCommand(state.schema.nodes.checkListItem),
                            )}
                        />
                    )}
                </Box>
            </Box>
        </Box>
    );
}

function ContentEditorMobileKeyboardSubstituteButton({
    icon,
    label,
    labelProps,
    isActive,
    onPress,
}: {
    icon: ReactNode;
    label: string;
    labelProps?: BoxProps;
    isActive: boolean;
    onPress: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({onPress});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Box paddingY="0.5" paddingX="2" {...mergeProps(hoverProps, pressProps)}>
            <Box
                width="full"
                height="full"
                paddingX="3"
                fontSize="100"
                display="flex"
                alignItems="center"
                gap="2.5"
                borderRadius="md"
                color={isPressed || isActive ? "grey-text" : "grey-70"}
                backgroundColor={
                    isPressedAndActive
                        ? "grey-20"
                        : isPressed || isActive
                        ? "grey-10"
                        : isHovered
                        ? "grey-5"
                        : undefined
                }
            >
                <IconContext.Provider value={{color: "currentColor", size: spacing["4"]}}>
                    {icon}
                </IconContext.Provider>
                <Box color="grey-text" {...labelProps}>
                    {label}
                </Box>
            </Box>
        </Box>
    );
}

function fromCommand(viewRef: RefObject<EditorView | null>, command: Command): () => void {
    return () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch.bind(view), view);
    };
}
