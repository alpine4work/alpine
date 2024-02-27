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
import {Mark, Slice} from "prosemirror-model";
import {Command, EditorState, TextSelection} from "prosemirror-state";
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
import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {ContentEditorMobileLinkRouteState} from "~/client/content/content_editor_mobile_link_route.js";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {
    areAllNodesBlockType,
    areAllNodesListItemType,
    createToggleBlockTypeCommand,
    createToggleListItemsCommand,
    createToggleMarkCommand,
    getMarksSpanningAcrossEntireRange,
} from "~/client/content/internal/content_editor_prosemirror_helpers.js";
import {Box, BoxProps} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {nativeMobileBottomBarKeyboardSubstituteHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {Spacer} from "~/client/design/spacer.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {easeOutCubic, parseBezier} from "~/shared/design/easing.js";
import {HighlightColor, colorByHighlightColor} from "~/shared/design/highlight_color.js";
import {spacing} from "~/shared/design/spacing.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
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
        onLinkRouteOpen,
    }: {
        state: EditorState & {schema: ContentProsemirrorSchema};
        viewRef: RefObject<EditorView | null>;
        onClose: () => void;
        onLinkRouteOpen: (state: ContentEditorMobileLinkRouteState) => void;
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

    const selectionMarks = useMemo(
        () => getMarksSpanningAcrossEntireRange(state.doc, state.selection),
        [state.doc, state.selection],
    );

    const activeHighlightMark = useMemo(
        () => selectionMarks.find(mark => mark.type.name === "highlight") ?? null,
        [selectionMarks],
    );

    const selectHighlightColor = (highlightColor: HighlightColor | null) => {
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
                    state.schema.mark("highlight", {
                        color: highlightColor,
                    }),
                ),
            );
        } else {
            view.dispatch(
                state.tr.removeMark(
                    state.selection.from,
                    state.selection.to,
                    state.schema.marks.highlight,
                ),
            );
        }
    };

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
                {!isHighlightSelectorOpen ? (
                    <ContentEditorMobileKeyboardSubstituteMain
                        state={state}
                        viewRef={viewRef}
                        selectionMarks={selectionMarks}
                        activeHighlightMark={activeHighlightMark}
                        onLinkRouteOpen={onLinkRouteOpen}
                        // No animation when switching to the highlight selector. iOS has no animation
                        // when switching keyboard types. I promise following platform convention is
                        // the reason, not that I'm lazy.
                        onHighlightSelectorOpen={() => setIsHighlightSelectorOpen(true)}
                        onSelectHighlightColor={selectHighlightColor}
                    />
                ) : (
                    <ContentEditorMobileKeyboardSubstituteHighlightSelector
                        state={state}
                        viewRef={viewRef}
                        activeHighlightMark={activeHighlightMark}
                        onBack={() => setIsHighlightSelectorOpen(false)}
                        onSelectHighlightColor={selectHighlightColor}
                    />
                )}
            </Box>
        </Box>
    );
}

function ContentEditorMobileKeyboardSubstituteMain({
    state,
    viewRef,
    selectionMarks,
    activeHighlightMark,
    onLinkRouteOpen,
    onHighlightSelectorOpen,
    onSelectHighlightColor,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    selectionMarks: ReadonlyArray<Mark>;
    activeHighlightMark: Mark | null;
    onLinkRouteOpen: (state: ContentEditorMobileLinkRouteState) => void;
    onHighlightSelectorOpen: () => void;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
}) {
    const {isBoldActive, isItalicActive, isStrikeActive, isCodeActive} = useMemo(() => {
        const boldMark = state.schema.mark("bold");
        const italicMark = state.schema.mark("italic");
        const strikeMark = state.schema.mark("strike");
        const codeMark = state.schema.mark("code");

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
    }, [selectionMarks, state.schema, state.storedMarks]);

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

    const linkSelection = useMemo(() => expandSelectionAroundLinkMark(state), [state]);

    return (
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
                onPress={fromCommand(viewRef, createToggleMarkCommand(state.schema.mark("bold")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<TextItalic />}
                label="Italic"
                labelProps={{className: contentSchemaStyles.italicClassName}}
                isActive={isItalicActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(state.schema.mark("italic")))}
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
                        expandEmptySelectionAroundWord(state) ??
                        state.selection;

                    const view = assertExists(viewRef.current);

                    contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver ??=
                        createPromiseResolver();

                    // Blurring the editor should close our keyboard substitute so our closing
                    // promise animation resolves.
                    view.dom.blur();

                    const {text: selectionText, isEditable: isSelectionEditable} =
                        getSelectionSliceText(
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
                        onLinkRouteOpen({
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
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<TextStrikethrough />}
                label="Strikethrough"
                labelProps={{className: contentSchemaStyles.strikeClassName}}
                isActive={isStrikeActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(state.schema.mark("strike")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<Code />}
                label="Code"
                labelProps={{className: contentSchemaStyles.codeClassName}}
                isActive={isCodeActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(state.schema.mark("code")))}
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
    state,
    viewRef,
    activeHighlightMark,
    onBack,
    onSelectHighlightColor,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
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

/**
 * If the selection is empty and inside a word then return a selection that
 * covers that word. If the selection is at the edge of a word or already
 * covers some content, return null.
 */
function expandEmptySelectionAroundWord(state: EditorState): TextSelection | null {
    if (state.selection.from !== state.selection.to) return null;

    const nodeBefore = state.selection.$from.nodeBefore;
    if (nodeBefore && !nodeBefore.isText) return null;

    const nodeAfter = state.selection.$from.nodeAfter;
    if (nodeAfter && !nodeAfter.isText) return null;

    const textBefore = nodeBefore
        ? iterableFirst(Array.from(findUnicodeDefaultWordBoundarySpans(nodeBefore.text!)).reverse())
              ?.text ?? ""
        : "";
    const textAfter = nodeAfter
        ? iterableFirst(findUnicodeDefaultWordBoundarySpans(nodeAfter.text!))?.text ?? ""
        : "";

    const textAround = textBefore + textAfter;
    if (textAround.length <= 2) return null;

    const textAroundSpans = Array.from(findUnicodeDefaultWordBoundarySpans(textAround));
    const textAroundSpan =
        textAroundSpans.length === 1
            ? textAroundSpans[0]!
            : textAroundSpans.length === 2
            ? textAroundSpans[0]!.length > textAroundSpans[1]!.length
                ? textAroundSpans[0]!
                : textAroundSpans[1]!
            : null;
    if (!textAroundSpan) return null;

    return new TextSelection(
        state.doc.resolve(
            state.selection.from -
                (textAroundSpan.length === textAround.length ||
                textAroundSpan.length === textBefore.length
                    ? textBefore.length
                    : 0),
        ),
        state.doc.resolve(
            state.selection.from +
                (textAroundSpan.length === textAround.length ||
                textAroundSpan.length === textAfter.length
                    ? textAfter.length
                    : 0),
        ),
    );
}

/**
 * Expand the editor selection to include all text in the current text block
 * with the same link mark. If there's no link mark covering the selection
 * return null. Allows you to update a link mark all at once.
 */
function expandSelectionAroundLinkMark(
    state: EditorState,
): {selection: TextSelection; mark: Mark} | null {
    if (!(state.selection instanceof TextSelection)) return null;

    const parentNode = state.selection.$from.parent;
    if (!parentNode.isTextblock) return null;
    if (parentNode !== state.selection.$to.parent) return null;

    let mark: Mark | undefined;

    // 1. Try to find the mark within the selection (if selection is not empty)
    const selectionSlice = state.selection.content();
    let isSelectionNodeMissingMark = false;
    selectionSlice.content.nodesBetween(0, selectionSlice.content.size, node => {
        if (!node.isText) return;
        if (isSelectionNodeMissingMark) return;

        const currentMark = node?.marks.find(mark => mark.type.name === "link");
        if (!currentMark) {
            isSelectionNodeMissingMark = true;
            return;
        }

        if (!mark) {
            mark = currentMark;
        } else if (!mark.eq(currentMark)) {
            isSelectionNodeMissingMark = true;
            return;
        }
    });
    if (isSelectionNodeMissingMark) return null;

    const selectionNodeBefore = state.selection.$from.nodeBefore;
    if (selectionNodeBefore && !selectionNodeBefore.isText) return null;

    const selectionNodeAfter = state.selection.$to.nodeAfter;
    if (selectionNodeAfter && !selectionNodeAfter.isText) return null;

    // 2. Try to find the mark before the selection (if selection isn't
    //    at start)
    const selectionNodeBeforeMark = selectionNodeBefore?.marks.find(
        mark => mark.type.name === "link",
    );
    if (selectionNodeBeforeMark) {
        if (!mark) {
            mark = selectionNodeBeforeMark;
        } else if (!mark.eq(selectionNodeBeforeMark)) {
            return null;
        }
    }

    // 3. Try to find the mark after the selection (if selection isn't
    //    at end)
    const selectionNodeAfterMark = selectionNodeAfter?.marks.find(
        mark => mark.type.name === "link",
    );
    if (selectionNodeAfterMark) {
        if (!mark) {
            mark = selectionNodeAfterMark;
        } else if (!mark.eq(selectionNodeAfterMark)) {
            return null;
        }
    }

    // If we found no mark, this isn't a link selection.
    if (!mark) return null;

    let extendFrom = selectionNodeBeforeMark ? selectionNodeBefore?.nodeSize ?? 0 : 0;
    if (selectionNodeBeforeMark) {
        // If `textOffset` is 0 then `nodeBefore` will be the full child before the
        // node `$from` points to.
        // https://github.com/ProseMirror/prosemirror-model/blob/a37b6b3adeb548dc9822211b680ce9d31be65842/src/resolvedpos.ts#L107-L115
        const startIndex =
            state.selection.$from.index() - (state.selection.$from.textOffset === 0 ? 2 : 1);

        for (let i = startIndex; i >= 0; i--) {
            const previousNode = parentNode.child(i);
            if (previousNode.marks.some(otherMark => otherMark.eq(mark!))) {
                extendFrom += previousNode.nodeSize;
            } else {
                break;
            }
        }
    }

    let extendTo = selectionNodeAfterMark ? selectionNodeAfter?.nodeSize ?? 0 : 0;
    if (selectionNodeAfterMark) {
        const startIndex = state.selection.$to.index() + 1;

        for (let i = startIndex; i < parentNode.childCount; i++) {
            const nextNode = parentNode.child(i);
            if (nextNode.marks.some(otherMark => otherMark.eq(mark!))) {
                extendTo += nextNode.nodeSize;
            } else {
                break;
            }
        }
    }

    const selection = new TextSelection(
        state.doc.resolve(state.selection.from - extendFrom),
        state.doc.resolve(state.selection.to + extendTo),
    );

    return {selection, mark};
}

/**
 * Is the slice (from a selection) editable? Returns a single line of text from
 * the selection regardless of whether it's editable or not. If the text spans
 * multiple nodes then we print a single line of text with
 * `printContentSingleLineTextSnippet()`.
 */
function getSelectionSliceText(
    selectionSlice: Slice,
    references: ContentReferences,
): {text: string; isEditable: boolean} {
    if (selectionSlice.content.childCount === 0) return {text: "", isEditable: true};

    const schema = selectionSlice.content.firstChild!.type.schema;

    let textNode =
        selectionSlice.content.childCount === 1 ? selectionSlice.content.firstChild! : null;
    if (textNode) {
        let count = selectionSlice.openStart;
        while (textNode && count > 0) {
            count--;
            textNode = textNode.content.childCount === 1 ? textNode.firstChild! : null;
        }
    }

    if (selectionSlice.openStart !== selectionSlice.openEnd || !textNode?.isText) {
        return {
            text: printContentSingleLineTextSnippet({
                // Intentionally calling `create()` and not `createChecked()` since for some
                // schemas (e.g. documents) our slice may not match the expected schema.
                doc: schema.topNodeType.create({}, selectionSlice.content.content),
                references,
            }),
            isEditable: false,
        };
    }

    return {
        text: textNode.text!,
        isEditable: true,
    };
}
