import {animate} from "motion";
import {
    ArrowLeft,
    Check,
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
import {Mark} from "prosemirror-model";
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
import {createPortal} from "react-dom";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {
    ContentEditorMobileLinkModalState,
    getContentEditorMobileLinkModalSelectionSliceText,
} from "~/client/content/internal/content_editor_mobile_link_modal.js";
import {areAllNodesBlockType} from "~/client/content/internal/helpers/are_all_nodes_block_type.js";
import {areAllNodesListItemType} from "~/client/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleBlockTypeCommand} from "~/client/content/internal/helpers/create_toggle_block_type_command.js";
import {createToggleListItemsCommand} from "~/client/content/internal/helpers/create_toggle_list_items_command.js";
import {createToggleMarkCommand} from "~/client/content/internal/helpers/create_toggle_mark_command.js";
import {expandEmptySelectionAroundWord} from "~/client/content/internal/helpers/expand_empty_selection_around_word.js";
import {expandSelectionAroundMark} from "~/client/content/internal/helpers/expand_selection_around_mark.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {Box, BoxProps} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {mobileBottomBarKeyboardSubstituteHeight} from "~/client/design/mobile_bottom_bar.js";
import {
    mobileModalAnimationDurationMs,
    mobileModalAnimationEasingParsedCubicBezier,
} from "~/client/design/mobile_modal.js";
import {useOverlayMobileKeyboardPortalElement} from "~/client/design/overlay_mobile_keyboard_sink_context_provider.js";
import {Spacer} from "~/client/design/spacer.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {HighlightColor, colorByHighlightColor} from "~/shared/design/highlight_color.js";
import {spacing} from "~/shared/design/spacing.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";
import {buttonStyles, colorSchemeVars, contentSchemaStyles} from "~/shared/styles/styles.js";

export type ContentEditorMobileKeyboardSubstituteRef = {
    closeWithAnimation(): void;
};

const ContentEditorMobileKeyboardSubstituteForwardRef = forwardRef(
    ContentEditorMobileKeyboardSubstitute,
);
export {ContentEditorMobileKeyboardSubstituteForwardRef as ContentEditorMobileKeyboardSubstitute};

let contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver: PromiseResolver<void> | null =
    null;

function ContentEditorMobileKeyboardSubstitute(
    {
        state,
        viewRef,
        onClose,
        onLinkModalOpen,
    }: {
        state: EditorState & {schema: ContentProsemirrorSchema};
        viewRef: RefObject<EditorView | null>;
        onClose: () => void;
        onLinkModalOpen: (state: ContentEditorMobileLinkModalState) => void;
    },
    ref: Ref<ContentEditorMobileKeyboardSubstituteRef>,
) {
    const {schema} = state;

    const portalElement = assertExists(
        useOverlayMobileKeyboardPortalElement(),
        "Can't server render `<ContentEditorMobileKeyboardSubstitute>`",
    );

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
                duration: mobileModalAnimationDurationMs / 1000,
                easing: mobileModalAnimationEasingParsedCubicBezier,
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
                duration: mobileModalAnimationDurationMs / 1000,
                easing: mobileModalAnimationEasingParsedCubicBezier,
                // Make sure we use hardware acceleration for this animation in WebKit. By
                // default `motion` turns it off.
                // https://motion.dev/guides/performance#webkits-exceptions
                allowWebkitAcceleration: true,
            },
        );

        animation.finished.finally(() => {
            onClose();
            contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver?.resolve();
            contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver = null;
        });
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

    const [isHighlightSelectorOpen, setIsHighlightSelectorOpen] = useState(false);
    if (!schema.marks.highlight && isHighlightSelectorOpen) setIsHighlightSelectorOpen(false);

    const selectionMarks = useMemo(
        () => getMarksSpanningAcrossEntireRange(state.doc, state.selection),
        [state.doc, state.selection],
    );

    const activeHighlightMark = useMemo(
        () =>
            schema.marks.highlight
                ? selectionMarks.find(mark => mark.type.name === "highlight") ?? null
                : null,
        [schema.marks.highlight, selectionMarks],
    );

    const selectHighlightColor = (highlightColor: HighlightColor | null) => {
        if (!schema.marks.highlight) return;

        const view = assertExists(viewRef.current);
        const {state} = view;

        if (
            highlightColor &&
            (!activeHighlightMark || activeHighlightMark.attrs.color !== highlightColor)
        ) {
            const range = trimSpacesFromProsemirrorRange(state.doc, state.selection);
            view.dispatch(
                state.tr.addMark(
                    range.from,
                    range.to,
                    schema.mark("highlight", {
                        color: highlightColor,
                    }),
                ),
            );
        } else {
            view.dispatch(
                state.tr.removeMark(
                    state.selection.from,
                    state.selection.to,
                    schema.marks.highlight,
                ),
            );
        }
    };

    return createPortal(
        <Box
            ref={substituteRef}
            position="absolute"
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
                style={{height: mobileBottomBarKeyboardSubstituteHeight}}
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
                {!isHighlightSelectorOpen ? (
                    <ContentEditorMobileKeyboardSubstituteMain
                        state={state}
                        viewRef={viewRef}
                        selectionMarks={selectionMarks}
                        activeHighlightMark={activeHighlightMark}
                        onLinkModalOpen={onLinkModalOpen}
                        // No animation when switching to the highlight selector. iOS has no animation
                        // when switching keyboard types. I promise following platform convention is
                        // the reason, not that I'm lazy.
                        onHighlightSelectorOpen={() => setIsHighlightSelectorOpen(true)}
                        onSelectHighlightColor={selectHighlightColor}
                    />
                ) : (
                    <ContentEditorMobileKeyboardSubstituteHighlightSelector
                        activeHighlightMark={activeHighlightMark}
                        onBack={() => setIsHighlightSelectorOpen(false)}
                        onSelectHighlightColor={selectHighlightColor}
                    />
                )}
            </Box>
        </Box>,
        // Portal into the root element so we aren't affected by whatever scroll view
        // this is rendered in.
        portalElement,
    );
}

function ContentEditorMobileKeyboardSubstituteMain({
    state,
    viewRef,
    selectionMarks,
    activeHighlightMark,
    onLinkModalOpen,
    onHighlightSelectorOpen,
    onSelectHighlightColor,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    selectionMarks: ReadonlyArray<Mark>;
    activeHighlightMark: Mark | null;
    onLinkModalOpen: (state: ContentEditorMobileLinkModalState) => void;
    onHighlightSelectorOpen: () => void;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
}) {
    const {schema} = state;

    const {isBoldActive, isItalicActive, isStrikeActive, isCodeActive} = useMemo(() => {
        const boldMark = schema.mark("bold");
        const italicMark = schema.mark("italic");
        const strikeMark = schema.mark("strike");
        const codeMark = schema.mark("code");

        return {
            isBoldActive:
                boldMark.isInSet(selectionMarks) ||
                (!!state.storedMarks && boldMark.isInSet(state.storedMarks)),
            isItalicActive:
                italicMark.isInSet(selectionMarks) ||
                (!!state.storedMarks && italicMark.isInSet(state.storedMarks)),
            isStrikeActive:
                strikeMark.isInSet(selectionMarks) ||
                (!!state.storedMarks && strikeMark.isInSet(state.storedMarks)),
            isCodeActive:
                codeMark.isInSet(selectionMarks) ||
                (!!state.storedMarks && codeMark.isInSet(state.storedMarks)),
        };
    }, [selectionMarks, schema, state.storedMarks]);

    const isUnorderedListItemActive = useMemo(
        () => areAllNodesListItemType(state.doc, state.selection, schema.nodes.unorderedListItem),
        [state.doc, schema.nodes.unorderedListItem, state.selection],
    );

    const isOrderedListItemActive = useMemo(
        () => areAllNodesListItemType(state.doc, state.selection, schema.nodes.orderedListItem),
        [state.doc, schema.nodes.orderedListItem, state.selection],
    );

    const isCheckListItemActive = useMemo(
        () =>
            !!schema.nodes.checkListItem &&
            areAllNodesListItemType(state.doc, state.selection, schema.nodes.checkListItem),
        [state.doc, schema.nodes.checkListItem, state.selection],
    );

    const isHeadingLevel1Active = useMemo(
        () =>
            !!schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, schema.nodes.heading, {
                level: 1,
            }),
        [state.doc, schema.nodes.heading, state.selection],
    );

    const isHeadingLevel2Active = useMemo(
        () =>
            !!schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, schema.nodes.heading, {
                level: 2,
            }),
        [state.doc, schema.nodes.heading, state.selection],
    );

    const isHeadingLevel3Active = useMemo(
        () =>
            !!schema.nodes.heading &&
            areAllNodesBlockType(state.doc, state.selection, schema.nodes.heading, {
                level: 3,
            }),
        [state.doc, schema.nodes.heading, state.selection],
    );

    const linkSelection = useMemo(
        () => expandSelectionAroundMark(state.doc, state.selection, "link"),
        [state],
    );

    return (
        <Box
            flexGrow="1"
            paddingBottom={
                // If there are fewer available styles, add some padding to the end so the
                // existing style buttons aren't too big.
                !schema.marks.highlight && !schema.nodes.checkListItem ? "4" : undefined
            }
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gridTemplateRows:
                    // We need different grid layouts depending on the available styles. Documents
                    // need 6 rows whereas task notes only need 5 rows.
                    !schema.marks.highlight && !schema.nodes.checkListItem
                        ? "repeat(5, 1fr)"
                        : "repeat(6, 1fr)",
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
                onPress={fromCommand(viewRef, createToggleMarkCommand(schema.mark("bold")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<TextItalic />}
                label="Italic"
                labelProps={{className: contentSchemaStyles.italicClassName}}
                isActive={isItalicActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(schema.mark("italic")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<LinkIcon />}
                label="Link"
                labelProps={{
                    className: contentSchemaStyles.linkClassName,
                    style: {color: "inherit"},
                }}
                isActive={!!linkSelection}
                onPress={() => {
                    const selection =
                        linkSelection?.selection ??
                        expandEmptySelectionAroundWord(state.doc, state.selection) ??
                        state.selection;

                    const view = assertExists(viewRef.current);

                    contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver ??=
                        createPromiseResolver();

                    // Blurring the editor should close our keyboard substitute so our closing
                    // promise animation resolves.
                    view.dom.blur();

                    const {text: selectionText, isEditable: isSelectionEditable} =
                        getContentEditorMobileLinkModalSelectionSliceText(
                            selection.content(),
                            getContentEditorReferences(view.state).references,
                        );

                    view.dispatch(view.state.tr.setSelection(selection));

                    Promise.race([
                        contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver.promise,
                        // The closing animation should take 250ms but just in case there's a bug that
                        // causes us to never resolve the promise, let's resolve in 1000ms.
                        wait(delayScreenTransitionLoadingIndicatorLimitMs),
                    ]).finally(() => {
                        onLinkModalOpen({
                            initialText:
                                // If selection text is not editable, truncate it so our URL isn't too long.
                                !isSelectionEditable && selectionText.length > 80
                                    ? `${selectionText.slice(0, 80)}…`
                                    : selectionText,
                            isTextEditable: isSelectionEditable,
                            initialUrl: linkSelection?.mark.attrs?.url ?? "",
                        });
                    });
                }}
            />
            {schema.marks.highlight && (
                <ContentEditorMobileKeyboardSubstituteButton
                    icon={<Palette />}
                    label="Highlight"
                    isActive={!!activeHighlightMark}
                    onPress={
                        activeHighlightMark
                            ? () => onSelectHighlightColor(null)
                            : onHighlightSelectorOpen
                    }
                />
            )}
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<TextStrikethrough />}
                label="Strikethrough"
                labelProps={{className: contentSchemaStyles.strikeClassName}}
                isActive={isStrikeActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(schema.mark("strike")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<Code />}
                label="Code"
                labelProps={{className: contentSchemaStyles.codeClassName}}
                isActive={isCodeActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(schema.mark("code")))}
            />
            {schema.nodes.heading && (
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
                            createToggleBlockTypeCommand(schema.nodes.heading, {
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
                            createToggleBlockTypeCommand(schema.nodes.heading, {
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
                            createToggleBlockTypeCommand(schema.nodes.heading, {
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
                    createToggleListItemsCommand(schema.nodes.unorderedListItem),
                )}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<ListNumbers />}
                label="Number list"
                isActive={isOrderedListItemActive}
                onPress={fromCommand(
                    viewRef,
                    createToggleListItemsCommand(schema.nodes.orderedListItem),
                )}
            />
            {schema.nodes.checkListItem && (
                <ContentEditorMobileKeyboardSubstituteButton
                    icon={<ListChecks />}
                    label="Check list"
                    isActive={isCheckListItemActive}
                    onPress={fromCommand(
                        viewRef,
                        createToggleListItemsCommand(schema.nodes.checkListItem),
                    )}
                />
            )}
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

function ContentEditorMobileKeyboardSubstituteHighlightSelector({
    activeHighlightMark,
    onBack,
    onSelectHighlightColor,
}: {
    activeHighlightMark: Mark | null;
    onBack: () => void;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
}) {
    return (
        <Box>
            <Box paddingLeft="4" display="flex" alignItems="center" gap="2.5">
                <IconButton
                    // Tapping on the button shouldn't unfocus the content editor.
                    isFocusable={false}
                    size="md"
                    description="Back"
                    withoutTooltip={true}
                    onPress={onBack}
                >
                    <ArrowLeft />
                </IconButton>
                <Palette color={colorSchemeVars["grey-70"]} size={spacing["4"]} />
                <Box color="grey-text" fontSize="100">
                    Highlight
                </Box>
            </Box>
            <Spacer space="4" />
            <Box paddingX="4" display="flex" gap="2.5">
                <ContentEditorMobileKeyboardSubstituteHighlightSelectorButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Red}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightSelectorButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Orange}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightSelectorButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Green}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightSelectorButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Blue}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightSelectorButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Purple}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
            </Box>
            <Spacer space="4" />
            <Box paddingX="4" display="flex" justifyContent="flex-end">
                <Button
                    variant="neutral"
                    // Tapping on the button shouldn't unfocus the content editor.
                    isFocusable={false}
                    isDisabled={!activeHighlightMark}
                    onPress={() => onSelectHighlightColor(null)}
                >
                    Clear
                </Button>
            </Box>
        </Box>
    );
}

function ContentEditorMobileKeyboardSubstituteHighlightSelectorButton({
    activeHighlightMark,
    highlightColor,
    onSelectHighlightColor,
}: {
    activeHighlightMark: Mark | null;
    highlightColor: HighlightColor;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
}) {
    const isActive = activeHighlightMark?.attrs.color === highlightColor;

    const {isPressed, pressProps} = usePress({
        onPress: () => onSelectHighlightColor(highlightColor),
    });

    return (
        <Box
            {...pressProps}
            flexGrow="1"
            backgroundColor={highlightColor ? colorByHighlightColor[highlightColor] : undefined}
            borderRadius="lg"
            position="relative"
            zIndex="0"
            overflow="hidden"
        >
            <Box
                style={{
                    // CSS trick: Padding and margin percentages are always based on element width.
                    // Even when setting `padding-bottom` or `margin-bottom`. In this case it
                    // allows us to create a square when the width is dynamic.
                    paddingBottom: "100%",
                }}
            />
            <Box
                position="absolute"
                inset="0"
                display="flex"
                justifyContent="center"
                alignItems="center"
                color="grey-text"
                fontSize="300"
            >
                A
            </Box>
            {isActive && (
                <Box color={`${highlightColor}-60`} position="absolute" top="0.5" right="1">
                    <Check weight="bold" size={spacing["4"]} />
                </Box>
            )}
            {isPressed && (
                <Box
                    position="absolute"
                    inset="0"
                    backgroundColor="grey-dark"
                    pointerEvents="none"
                    style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                />
            )}
        </Box>
    );
}
