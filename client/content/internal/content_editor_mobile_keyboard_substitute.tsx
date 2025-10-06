import {animate} from "motion";
import {
    ArrowLeft,
    Check,
    Code,
    File,
    IconContext,
    Image,
    Link as LinkIcon,
    ListBullets,
    ListChecks,
    ListNumbers,
    Minus,
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
import {Command, EditorState, Selection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    Dispatch,
    ReactNode,
    RefObject,
    SetStateAction,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {createPortal, flushSync} from "react-dom";
import {
    insertContentCodeBlock,
    insertContentDivider,
    insertContentFiles,
    insertContentQuoteBlock,
} from "~/client/content/internal/content_editor_insert.js";
import {ContentEditorMobileLinkModalState} from "~/client/content/internal/content_editor_mobile_link_modal.js";
import {getContentEditorMobileLinkModalSelectionSliceText} from "~/client/content/internal/get_content_editor_mobile_link_modal_selection_slice_text.js";
import {areAllNodesBlockType} from "~/client/content/internal/helpers/are_all_nodes_block_type.js";
import {areAllNodesListItemType} from "~/client/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleBlockTypeCommand} from "~/client/content/internal/helpers/create_toggle_block_type_command.js";
import {createToggleListItemsCommand} from "~/client/content/internal/helpers/create_toggle_list_items_command.js";
import {expandEmptySelectionAroundWord} from "~/client/content/internal/helpers/expand_empty_selection_around_word.js";
import {expandSelectionAroundMark} from "~/client/content/internal/helpers/expand_selection_around_mark.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {selectFiles} from "~/client/content/select_files.js";
import {getContentEditorReferences} from "~/client/content/state/content_editor_state.js";
import {createToggleMarkCommand} from "~/client/content/state/create_toggle_mark_command.js";
import {Box, BoxProps} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {mobileBottomBarKeyboardSubstituteHeight} from "~/client/design/mobile_bottom_bar.js";
import {
    mobileFullScreenModalAnimationDurationMs,
    mobileFullScreenModalAnimationEasingParsedCubicBezier,
} from "~/client/design/mobile_full_screen_modal.js";
import {useOverlayRootPortalElement} from "~/client/design/overlay_helpers.js";
import {Spacer} from "~/client/design/spacer.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {CodeBlockIcon} from "~/client/icons/code_block_icon.js";
import {QuoteBlockIcon} from "~/client/icons/quote_block_icon.js";
import {VideoIcon} from "~/client/icons/video_icon.js";
import {WaveformIcon} from "~/client/icons/waveform_icon.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {buttonStyles, colorSchemeVars, greyElevated2ClassName} from "~/client/styles/styles.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {
    codeClassName,
    italicClassName,
    linkClassName,
    strikeClassName,
} from "~/shared/content/content_styles.js";
import {HighlightColor, colorByHighlightColor} from "~/shared/design/core/highlight_color.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {
    getFileAudioContentTypes,
    getFileImageContentTypes,
    getFileVideoContentTypes,
} from "~/shared/files/file_content_type.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {throwError} from "~/shared/helpers/control/throw_error.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

let contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver: PromiseResolver<void> | null =
    null;

export function ContentEditorMobileKeyboardSubstitute({
    state,
    viewRef,
    isFocused,
    onClose,
    onLinkModalOpen,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
          })
        | null
    >;
    isFocused: boolean;
    onClose: () => void;
    onLinkModalOpen: (state: ContentEditorMobileLinkModalState) => void;
}) {
    const {schema} = state;

    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can’t server render `<ContentEditorMobileKeyboardSubstitute>`",
    );

    const substituteRef = useRef<HTMLDivElement>(null);

    const [isClosing, setIsClosing] = useState(false);

    const hasAnimatedOpenedRef = useRef(false);
    useEffect(() => {
        if (hasAnimatedOpenedRef.current) return;
        hasAnimatedOpenedRef.current = true;

        const substituteElement = assertExists(substituteRef.current);

        void animate(
            substituteElement,
            {y: [0, -substituteElement.getBoundingClientRect().height]},
            {
                duration: mobileFullScreenModalAnimationDurationMs / 1000,
                ease: mobileFullScreenModalAnimationEasingParsedCubicBezier,
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
                duration: mobileFullScreenModalAnimationDurationMs / 1000,
                ease: mobileFullScreenModalAnimationEasingParsedCubicBezier,
            },
        );

        void animation.finished.finally(() => {
            onClose();
            contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver?.resolve();
            contentEditorMobileKeyboardSubstituteClosingAnimationPromiseResolver = null;
        });
    });

    const [variant, setVariant] = useState<"Styles" | "HighlightStyle" | "Insert">("Styles");

    const [insertVariantSelectingFilesCount, setInsertVariantSelectingFilesCount] = useState(0);
    if (insertVariantSelectingFilesCount !== 0 && variant !== "Insert")
        setInsertVariantSelectingFilesCount(0);

    useEffect(() => {
        if (!isFocused && insertVariantSelectingFilesCount === 0) {
            setIsClosing(true);
        }
    }, [insertVariantSelectingFilesCount, isFocused]);

    if (!schema.marks.highlight && variant === "HighlightStyle") setVariant("Styles");

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
            data-testid="ContentEditorMobileKeyboardSubstitute"
            className={greyElevated2ClassName}
            position="absolute"
            // Render above everything on the page including toolbar.
            zIndex="70"
            left="0"
            right="0"
            backgroundColor="grey-0"
            borderTopRadius="3"
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
                    paddingX="1.5"
                    height="10"
                    display="flex"
                    alignItems="center"
                    gap="1"
                >
                    {variant === "HighlightStyle" ? (
                        <Box paddingLeft="0.5" display="flex" alignItems="center" gap="2">
                            <IconButton
                                // Tapping on the button shouldn't unfocus the content editor.
                                isFocusable={false}
                                size="md"
                                description="Back"
                                withoutTooltip={true}
                                onPress={() => setVariant("Styles")}
                            >
                                <ArrowLeft />
                            </IconButton>
                            <Palette color={colorSchemeVars["grey-70"]} size={spacing["4"]} />
                            <Box color="grey-100" fontSize="100">
                                Highlight
                            </Box>
                        </Box>
                    ) : (
                        <>
                            <Button
                                variant={variant === "Styles" ? "quiet-on" : "quiet-off"}
                                height="7"
                                borderRadius="2"
                                onPress={() => setVariant("Styles")}
                            >
                                Styles
                            </Button>
                            <Button
                                variant={variant === "Insert" ? "quiet-on" : "quiet-off"}
                                height="7"
                                borderRadius="2"
                                onPress={() => setVariant("Insert")}
                            >
                                Insert
                            </Button>
                        </>
                    )}
                </Box>
                {variant === "Styles" ? (
                    <ContentEditorMobileKeyboardSubstituteStyles
                        state={state}
                        viewRef={viewRef}
                        selectionMarks={selectionMarks}
                        activeHighlightMark={activeHighlightMark}
                        onLinkModalOpen={onLinkModalOpen}
                        // No animation when switching to the highlight selector. iOS has no animation
                        // when switching keyboard types. I promise following platform convention is
                        // the reason, not that I'm lazy.
                        onHighlightSelectorOpen={() => setVariant("HighlightStyle")}
                        onSelectHighlightColor={selectHighlightColor}
                    />
                ) : variant === "HighlightStyle" ? (
                    <ContentEditorMobileKeyboardSubstituteHighlightStyle
                        activeHighlightMark={activeHighlightMark}
                        onSelectHighlightColor={selectHighlightColor}
                    />
                ) : variant === "Insert" ? (
                    <ContentEditorMobileKeyboardSubstituteInsert
                        state={state}
                        viewRef={viewRef}
                        setSelectingFilesCount={setInsertVariantSelectingFilesCount}
                    />
                ) : (
                    throwError(exhaustive(variant))
                )}
            </Box>
        </Box>,
        // Portal into the root element so we aren't affected by whatever scroll view
        // this is rendered in.
        portalElement,
    );
}

function ContentEditorMobileKeyboardSubstituteStyles({
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
    const {space} = useSpaceContext();

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
                labelProps={{className: italicClassName}}
                isActive={isItalicActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(schema.mark("italic")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<LinkIcon />}
                label="Link"
                labelProps={{
                    className: linkClassName,
                    style: {color: colorSchemeVars["grey-100"]},
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
                            store => store.getSnapshot(),
                            space.id,
                            selection.content(),
                            getContentEditorReferences(view.state).references,
                        );

                    view.dispatch(view.state.tr.setSelection(selection));

                    void Promise.race([
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
                    onPress={() => {
                        if (activeHighlightMark) {
                            onSelectHighlightColor(null);
                        } else {
                            onHighlightSelectorOpen();
                        }
                    }}
                />
            )}
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<TextStrikethrough />}
                label="Strikethrough"
                labelProps={{className: strikeClassName}}
                isActive={isStrikeActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(schema.mark("strike")))}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<Code />}
                label="Code"
                labelProps={{className: codeClassName}}
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
    isActive?: boolean;
    onPress: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({onPress});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        ([isPressed]) => isPressed && isActive,
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
                borderRadius="1.5"
                color={isPressed || isActive ? "grey-100" : "grey-70"}
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
                <Box color="grey-100" {...labelProps}>
                    {label}
                </Box>
            </Box>
        </Box>
    );
}

function fromCommand(viewRef: RefObject<EditorView | null>, command: Command): () => void {
    return () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch, view);
    };
}

function ContentEditorMobileKeyboardSubstituteHighlightStyle({
    activeHighlightMark,
    onSelectHighlightColor,
}: {
    activeHighlightMark: Mark | null;
    onSelectHighlightColor: (highlightColor: HighlightColor | null) => void;
}) {
    return (
        <Box paddingTop="4">
            <Box paddingX="4" display="flex" gap="2.5">
                <ContentEditorMobileKeyboardSubstituteHighlightStyleButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Red}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightStyleButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Orange}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightStyleButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Green}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightStyleButton
                    activeHighlightMark={activeHighlightMark}
                    highlightColor={HighlightColor.Blue}
                    onSelectHighlightColor={onSelectHighlightColor}
                />
                <ContentEditorMobileKeyboardSubstituteHighlightStyleButton
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

function ContentEditorMobileKeyboardSubstituteHighlightStyleButton({
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
            borderRadius="2"
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
                color="grey-100"
                fontSize="300"
            >
                A
            </Box>
            {isActive && (
                <Box
                    color={`${
                        highlightColor === HighlightColor.Blue ? "indigo" : highlightColor
                    }-60`}
                    position="absolute"
                    top="0.5"
                    right="1"
                >
                    <Check weight="bold" size={spacing["4"]} />
                </Box>
            )}
            {isPressed && (
                <Box
                    position="absolute"
                    inset="0"
                    backgroundColor="grey-100-const"
                    pointerEvents="none"
                    style={{opacity: buttonStyles.buttonPressedOverlayOpacity}}
                />
            )}
        </Box>
    );
}

function ContentEditorMobileKeyboardSubstituteInsert({
    state,
    viewRef,
    setSelectingFilesCount,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
          })
        | null
    >;
    setSelectingFilesCount: Dispatch<SetStateAction<number>>;
}) {
    const {schema} = state;

    const containerRef = useRef<HTMLDivElement>(null);

    const hasFewerRows = !schema.marks.highlight && !schema.nodes.checkListItem;

    return (
        <Box
            ref={containerRef}
            flexGrow="1"
            paddingBottom={
                // If there are fewer available styles, add some padding to the end so the
                // existing style buttons aren't too big.
                hasFewerRows ? "4" : undefined
            }
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gridTemplateRows:
                    // We need different grid layouts depending on the available styles. Documents
                    // need 6 rows whereas task notes only need 5 rows.
                    hasFewerRows ? "repeat(5, 1fr)" : "repeat(6, 1fr)",
                gridAutoFlow: "column",
                // Simple border down the middle with gradient. Solution inspired by:
                // https://stackoverflow.com/a/61678228/1568890
                background: `linear-gradient(${colorSchemeVars["grey-5"]}, ${colorSchemeVars["grey-5"]}) center/1px 100% no-repeat`,
            }}
        >
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<Image />}
                label="Image"
                onPress={() => {
                    // The `flushSync()` makes sure `selectingFilesCount` and `isFocused` (from
                    // `<ContentEditor>`) are updated in the same render given `isFocused` is
                    // usually updated in a `flushSync()`.
                    flushSync(() => {
                        setSelectingFilesCount(n => n + 1);

                        selectFiles(assertExists(containerRef.current), {
                            multiple: true,
                            acceptContentTypes: getFileImageContentTypes(),
                        })
                            .then(files => {
                                if (files.length === 0) return;
                                if (!viewRef.current) return;
                                insertContentFiles(viewRef.current, files);
                            })
                            .catch(scheduleUncaughtError)
                            .finally(() => setSelectingFilesCount(n => n - 1));
                    });
                }}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<VideoIcon />}
                label="Video"
                onPress={() => {
                    // The `flushSync()` makes sure `selectingFilesCount` and `isFocused` (from
                    // `<ContentEditor>`) are updated in the same render given `isFocused` is
                    // usually updated in a `flushSync()`.
                    flushSync(() => {
                        setSelectingFilesCount(n => n + 1);

                        selectFiles(assertExists(containerRef.current), {
                            multiple: true,
                            acceptContentTypes: getFileVideoContentTypes(),
                        })
                            .then(files => {
                                if (files.length === 0) return;
                                if (!viewRef.current) return;
                                insertContentFiles(viewRef.current, files);
                            })
                            .catch(scheduleUncaughtError)
                            .finally(() => setSelectingFilesCount(n => n - 1));
                    });
                }}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<WaveformIcon />}
                label="Audio"
                onPress={() => {
                    // The `flushSync()` makes sure `selectingFilesCount` and `isFocused` (from
                    // `<ContentEditor>`) are updated in the same render given `isFocused` is
                    // usually updated in a `flushSync()`.
                    flushSync(() => {
                        setSelectingFilesCount(n => n + 1);

                        selectFiles(assertExists(containerRef.current), {
                            multiple: true,
                            acceptContentTypes: getFileAudioContentTypes(),
                        })
                            .then(files => {
                                if (files.length === 0) return;
                                if (!viewRef.current) return;
                                insertContentFiles(viewRef.current, files);
                            })
                            .catch(scheduleUncaughtError)
                            .finally(() => setSelectingFilesCount(n => n - 1));
                    });
                }}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<File />}
                label="File"
                onPress={() => {
                    // The `flushSync()` makes sure `selectingFilesCount` and `isFocused` (from
                    // `<ContentEditor>`) are updated in the same render given `isFocused` is
                    // usually updated in a `flushSync()`.
                    flushSync(() => {
                        setSelectingFilesCount(n => n + 1);

                        selectFiles(assertExists(containerRef.current), {multiple: true})
                            .then(files => {
                                if (files.length === 0) return;
                                if (!viewRef.current) return;
                                insertContentFiles(viewRef.current, files);
                            })
                            .catch(scheduleUncaughtError)
                            .finally(() => setSelectingFilesCount(n => n - 1));
                    });
                }}
            />
            <Box />
            {!hasFewerRows && <Box />}
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<Minus />}
                label="Divider"
                onPress={() => {
                    insertContentDivider(assertExists(viewRef.current));
                }}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<QuoteBlockIcon />}
                label="Quote block"
                onPress={() => {
                    insertContentQuoteBlock(assertExists(viewRef.current));
                }}
            />
            <ContentEditorMobileKeyboardSubstituteButton
                icon={<CodeBlockIcon />}
                label="Code block"
                onPress={() => {
                    insertContentCodeBlock(assertExists(viewRef.current));
                }}
            />
        </Box>
    );
}
