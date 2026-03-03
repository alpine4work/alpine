import {animate} from "motion";
import {
    At,
    ChatCircleText,
    DotsThreeVertical,
    IconContext,
    ListBullets,
    ListChecks,
    ListNumbers,
    TextBolder,
    TextIndent,
    TextItalic,
    TextOutdent,
} from "phosphor-react";
import {Command, EditorState, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useEffect, useId, useMemo, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {createPortal} from "react-dom";
import {ContentEditorMobileKeyboardSubstitute} from "~/client/web/content/internal/content_editor_mobile_keyboard_substitute.js";
import {ContentEditorMobileLinkModalState} from "~/client/web/content/internal/content_editor_mobile_link_modal.js";
import {areAllNodesListItemType} from "~/client/web/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleListItemsCommand} from "~/client/web/content/internal/helpers/create_toggle_list_items_command.js";
import {expandEmptySelectionAroundWord} from "~/client/web/content/internal/helpers/expand_empty_selection_around_word.js";
import {expandSelectionAroundMark} from "~/client/web/content/internal/helpers/expand_selection_around_mark.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/web/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {openContentEditorMentionFloaterMetaKey} from "~/client/web/content/state/content_editor_meta_keys.js";
import {isContinuouslyTypingInContentEditor} from "~/client/web/content/state/content_editor_state.js";
import {createToggleMarkCommand} from "~/client/web/content/state/create_toggle_mark_command.js";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/web/content/state/indent_and_dedent_list_item_commands.js";
import {Box} from "~/client/web/design/box.js";
import {
    mobileBottomBarKeyboardToolbarHeight,
    mobileBottomBarKeyboardToolbarHeightRem,
} from "~/client/web/design/mobile_bottom_bar.js";
import {useOverlayRootPortalElement} from "~/client/web/design/overlay_helpers.js";
import {
    useRegisterBottomBarMobileKeyboardToolbarFrame,
    useWebMobileKeyboardToolbarSafeAreaInsetBottom,
} from "~/client/web/design/subscribe_to_bottom_bar_frame_change.js";
import {isMobileWebKit} from "~/client/web/helpers/browser/is_mobile_web_kit.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";

export function ContentEditorMobileKeyboardToolbar({
    state,
    viewRef,
    isFocused,
    openCommentThread,
    onLinkModalOpen,
    onCommentInputOpen,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
          })
        | null
    >;
    isFocused: boolean;
    openCommentThread: ((commentThreadId: DocumentCommentThreadId) => Promise<void>) | undefined;
    onLinkModalOpen: (state: ContentEditorMobileLinkModalState) => void;
    onCommentInputOpen: (setSelection?: TextSelection | null) => void;
}) {
    const {schema} = state;

    const isMounted = useIsMounted();
    const {isNativeMobile} = useClientInfo();

    const portalElement = assertExists(
        useOverlayRootPortalElement(),
        "Can\u2019t server render `<ContentEditorMobileKeyboardToolbar>`",
    );

    const toolbarRef = useRef<HTMLDivElement>(null);
    const id = useId();

    const [isToolbarRenderedFromState, setIsToolbarRendered] = useState(false);
    const isToolbarRendered = isToolbarRenderedFromState || isFocused;
    if (isToolbarRendered !== isToolbarRenderedFromState) setIsToolbarRendered(isToolbarRendered);

    const isAnimatingToolbarShowRef = useRef(false);
    useEffect(() => {
        // In our native mobile app, the native mobile wrapper is responsible for making
        // this toolbar visible.
        if (NativeMobileBridge) return;

        if (!isFocused) {
            isAnimatingToolbarShowRef.current = false;
            return;
        }

        if (isAnimatingToolbarShowRef.current) return;
        isAnimatingToolbarShowRef.current = true;

        const toolbarElement = assertExists(toolbarRef.current);

        void animate(
            toolbarElement,
            {y: [0, `-${mobileBottomBarKeyboardToolbarHeightRem}rem`]},
            {duration: 0.2},
        );
    }, [isFocused, isNativeMobile]);

    const isAnimatingToolbarHideRef = useRef(false);
    useEffect(() => {
        if (isFocused || !isToolbarRenderedFromState) {
            isAnimatingToolbarHideRef.current = false;
            return;
        }

        if (isAnimatingToolbarHideRef.current) return;
        isAnimatingToolbarHideRef.current = true;

        const toolbarElement = assertExists(toolbarRef.current);

        if (!NativeMobileBridge) {
            const animation = animate(
                toolbarElement,
                {y: [`-${mobileBottomBarKeyboardToolbarHeightRem}rem`, 0]},
                {duration: 0.2},
            );

            void animation.finished.finally(() => {
                setIsToolbarRendered(false);
            });
        } else {
            NativeMobileBridge.keyboard.scheduleAfterAnimation(() => {
                setIsToolbarRendered(false);
            });
        }
    }, [isFocused, isToolbarRenderedFromState]);

    const [isSubstituteOpen, setIsSubstituteOpen] = useState(false);

    // If we unmounted while the substitute is open then we need to run
    // `cleanupAfterSubstitute()`.
    useEffect(() => {
        return () => {
            if (!isMounted() && isSubstituteOpen) {
                void NativeMobileBridge?.keyboard.cleanupAfterSubstitute();
            }
        };
    }, [isSubstituteOpen, isMounted]);

    useRegisterBottomBarMobileKeyboardToolbarFrame({isDisabled: !isToolbarRendered});
    useWebMobileKeyboardToolbarSafeAreaInsetBottom({isVisible: isToolbarRendered});

    const {isBoldActive, isItalicActive} = useMemo(() => {
        const marks = getMarksSpanningAcrossEntireRange(state.doc, state.selection);

        const boldMark = schema.mark("bold");
        const italicMark = schema.mark("italic");

        return {
            isBoldActive:
                boldMark.isInSet(marks) ||
                (!!state.storedMarks && boldMark.isInSet(state.storedMarks)),
            isItalicActive:
                italicMark.isInSet(marks) ||
                (!!state.storedMarks && italicMark.isInSet(state.storedMarks)),
        };
    }, [state.doc, schema, state.selection, state.storedMarks]);

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

    const isIndentListItemEnabled = useMemo(
        () =>
            (isUnorderedListItemActive || isOrderedListItemActive || isCheckListItemActive) &&
            indentListItemCommand(state),
        [isCheckListItemActive, isOrderedListItemActive, isUnorderedListItemActive, state],
    );

    const isDedentListItemEnabled = useMemo(
        () =>
            (isUnorderedListItemActive || isOrderedListItemActive || isCheckListItemActive) &&
            dedentListItemCommand(state),
        [isCheckListItemActive, isOrderedListItemActive, isUnorderedListItemActive, state],
    );

    return (
        <>
            {isToolbarRendered &&
                createPortal(
                    <Box
                        ref={toolbarRef}
                        id={isNativeMobile ? `nmbb-kt-${id}` : id}
                        data-testid="ContentEditorMobileKeyboardToolbar"
                        // NOTE(calebmer): This is a little strange, we have a wrapper `<div>` with
                        // `spacing["2"]` padding height on our keyboard toolbar. I've observed this makes
                        // the animation when the iOS keyboard opens more consistent. Before adding this
                        // slop sometimes when animating the keyboard open the toolbar wouldn't be visible
                        // until half way through the animation then pop in. This looks janky. You can
                        // observe it in [this video][1] if you go frame by frame either time the keyboard
                        // opens. The toolbar pops in during the animation. This doesn't happen all the
                        // time. It's sporadic, mostly happening when the keyboard opens without needing to
                        // scroll the view.
                        //
                        // My theory is that somewhere iOS or Safari is un-rendering the element while it's
                        // offscreen and since we start the animation through non-traditional means
                        // (directly writing to Safari's `CALayer` transform property in native code) it
                        // gets rendered during the animation not before it. I've found adding this slop
                        // fixes the bug and makes the animation much more consistent. I don't have a
                        // proven reason as to why but my theory is the slop tricks iOS or Safari into
                        // thinking the toolbar is visible onscreen so needs to always be rendered.
                        //
                        // [1]: https://gist.github.com/calebmer/167a4853a187b44ed0621e2d667e7873
                        pointerEvents="none"
                        paddingTop="2"
                        marginTop="-2"
                        position="absolute"
                        // Render above everything on the page
                        zIndex="60"
                        left="0"
                        right="0"
                        style={{
                            top: `var(--space-outlet-height, 100svh)`,
                            transition:
                                // Animate after `--space-outlet-height` changes when the keyboard opens in mobile
                                // Safari (not our native app). This is a little hacky. Ideally we'd run the
                                // animation in our effect again but this is simple and we don't care too much
                                // about mobile Safari (we care a lot about our native app).
                                isFocused && isMobileWebKit && !isNativeMobile
                                    ? `top 250ms ease`
                                    : undefined,
                            // Our native mobile wrapper looks for compositing layers created from an element
                            // with an ID that starts with `nmbb-` and ties their position to the tab bar and
                            // software keyboard. So we get smooth animations while the keyboard opens or the
                            // tab bar shifts offscreen. To create a compositing layer we need to set
                            // `will-change: transform`. It's not specified that `will-change: transform` MUST
                            // create a compositing layer, instead some browser engines implement this hint
                            // themselves as an optimization.
                            //
                            // It so happens that WebKit is one of those browsers. Here's the code in WebKit
                            // that does this: [part 1][1], [part 2][2].
                            //
                            // [1]:
                            //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                            // [2]:
                            //     https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                            willChange: isNativeMobile ? "transform" : undefined,
                            // Set `transform` to its initial value assuming the tab bar is up. Since this is a
                            // keyboard toolbar (configured with `kt-` in the ID) it doesn't move with the tab
                            // bar.
                            transform: isNativeMobile ? "translateY(0px)" : undefined,
                        }}
                        // Suppress React hydration warnings in our native mobile app. The native mobile
                        // app sets the `transform` property on this element. Sometimes before React
                        // finishes hydrating. This is expected, React can ignore the difference.
                        suppressHydrationWarning={isNativeMobile ? true : undefined}
                    >
                        <Box
                            pointerEvents="auto"
                            height={mobileBottomBarKeyboardToolbarHeight}
                            backgroundColor="grey-5"
                            display="flex"
                            paddingX="0.5"
                            onPointerDownCapture={event => {
                                // Tapping on the toolbar shouldn't unfocus the content editor since that will
                                // remove the selection and hide the keyboard.
                                event.preventDefault();
                            }}
                        >
                            <ContentEditorMobileKeyboardToolbarButton
                                label="Insert"
                                dividerRight
                                isActive={false}
                                onPress={() => {
                                    const view = assertExists(viewRef.current);
                                    const {state} = view;
                                    const schema = state.doc.type.schema;

                                    view.dispatch(
                                        state.tr
                                            .replaceSelectionWith(schema.text("@"))
                                            .setMeta(openContentEditorMentionFloaterMetaKey, "@"),
                                    );
                                }}
                            >
                                <At />
                            </ContentEditorMobileKeyboardToolbarButton>
                            <ContentEditorMobileKeyboardToolbarButton
                                label="Bold"
                                dividerLeft
                                isActive={isBoldActive}
                                onPress={fromCommand(
                                    viewRef,
                                    createToggleMarkCommand(schema.mark("bold")),
                                )}
                            >
                                <TextBolder />
                            </ContentEditorMobileKeyboardToolbarButton>
                            <ContentEditorMobileKeyboardToolbarButton
                                label="Italic"
                                dividerRight
                                isActive={isItalicActive}
                                onPress={fromCommand(
                                    viewRef,
                                    createToggleMarkCommand(schema.mark("italic")),
                                )}
                            >
                                <TextItalic />
                            </ContentEditorMobileKeyboardToolbarButton>
                            {!isOrderedListItemActive && !isCheckListItemActive && (
                                <ContentEditorMobileKeyboardToolbarButton
                                    label="Bullet list"
                                    dividerLeft
                                    isActive={isUnorderedListItemActive}
                                    onPress={fromCommand(
                                        viewRef,
                                        createToggleListItemsCommand(
                                            schema.nodes.unorderedListItem,
                                        ),
                                    )}
                                >
                                    <ListBullets />
                                </ContentEditorMobileKeyboardToolbarButton>
                            )}
                            {!isUnorderedListItemActive && !isCheckListItemActive && (
                                <ContentEditorMobileKeyboardToolbarButton
                                    label="Number list"
                                    dividerLeft={isOrderedListItemActive}
                                    dividerRight={!isOrderedListItemActive}
                                    isActive={isOrderedListItemActive}
                                    onPress={fromCommand(
                                        viewRef,
                                        createToggleListItemsCommand(schema.nodes.orderedListItem),
                                    )}
                                >
                                    <ListNumbers />
                                </ContentEditorMobileKeyboardToolbarButton>
                            )}
                            {schema.nodes.checkListItem && isCheckListItemActive && (
                                <ContentEditorMobileKeyboardToolbarButton
                                    label="Check list"
                                    dividerLeft
                                    isActive={isCheckListItemActive}
                                    onPress={fromCommand(
                                        viewRef,
                                        createToggleListItemsCommand(schema.nodes.checkListItem),
                                    )}
                                >
                                    <ListChecks />
                                </ContentEditorMobileKeyboardToolbarButton>
                            )}
                            {(isOrderedListItemActive ||
                                isUnorderedListItemActive ||
                                isCheckListItemActive) && (
                                <>
                                    <ContentEditorMobileKeyboardToolbarButton
                                        label="Dedent"
                                        isActive={false}
                                        isDisabled={!isDedentListItemEnabled}
                                        onPress={fromCommand(viewRef, dedentListItemCommand)}
                                    >
                                        <TextOutdent />
                                    </ContentEditorMobileKeyboardToolbarButton>
                                    <ContentEditorMobileKeyboardToolbarButton
                                        label="Indent"
                                        dividerRight
                                        isActive={false}
                                        isDisabled={!isIndentListItemEnabled}
                                        onPress={fromCommand(viewRef, indentListItemCommand)}
                                    >
                                        <TextIndent />
                                    </ContentEditorMobileKeyboardToolbarButton>
                                </>
                            )}
                            {schema.marks.comment && (
                                <ContentEditorMobileKeyboardToolbarCommentButton
                                    state={state}
                                    openCommentThread={openCommentThread}
                                    onCommentInputOpen={onCommentInputOpen}
                                />
                            )}
                            <ContentEditorMobileKeyboardToolbarButton
                                label="More"
                                dividerLeft={!schema.marks.comment}
                                isActive={false}
                                onPress={() => {
                                    if (!NativeMobileBridge) {
                                        setIsSubstituteOpen(true);
                                    } else {
                                        void NativeMobileBridge.keyboard
                                            .prepareForSubstitute()
                                            .finally(() => {
                                                setIsSubstituteOpen(true);
                                            });
                                    }
                                }}
                            >
                                <DotsThreeVertical />
                            </ContentEditorMobileKeyboardToolbarButton>
                        </Box>
                    </Box>,
                    // Portal into the root element so we aren't affected by whatever scroll view this
                    // is rendered in.
                    portalElement,
                )}
            {isSubstituteOpen && (
                <ContentEditorMobileKeyboardSubstitute
                    state={state}
                    viewRef={viewRef}
                    isFocused={isFocused}
                    onClose={() => {
                        setIsSubstituteOpen(false);
                        void NativeMobileBridge?.keyboard.cleanupAfterSubstitute();
                    }}
                    onLinkModalOpen={onLinkModalOpen}
                />
            )}
        </>
    );
}

function ContentEditorMobileKeyboardToolbarButton({
    label,
    children,
    dividerLeft,
    dividerRight,
    isActive,
    isDisabled,
    onPress,
}: {
    label: string;
    children?: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
    isActive: boolean;
    isDisabled?: boolean;
    onPress: () => void;
}) {
    const {isHovered, hoverProps} = useHover({});
    const {isPressed, pressProps} = usePress({
        // Toolbar buttons should not be focusable since we don't want the content editor
        // to lose focus.
        preventFocusOnPress: true,
        isDisabled,
        onPress,
    });

    const pressAndHoverProps = mergeProps(hoverProps, pressProps);

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const isPressedAndActive = useStateWithDependenciesWithoutDispatch(
        ([isPressed]) => isPressed && isActive,
        [isPressed],
    );

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch and
                    // nothing happens (which can feel like a bug).
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no keyboard
                // navigation.
                {...pressAndHoverProps}
                aria-label={label}
                flexGrow="1"
                height="full"
                paddingY="1"
                paddingX="0.5"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <Box
                    width="full"
                    height="full"
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-100" : "grey-70"}
                    backgroundColor={
                        isDisabled
                            ? undefined
                            : isPressedAndActive
                              ? "grey-20"
                              : isHovered && isPressed
                                ? "grey-20"
                                : isPressed || isActive || isHovered
                                  ? "grey-10"
                                  : undefined
                    }
                    borderRadius="1.5"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <IconContext.Provider
                        value={{
                            color: "currentColor",
                            size: spacing["5"],
                        }}
                    >
                        {children}
                    </IconContext.Provider>
                </Box>
            </Box>
            {dividerRight && (
                <Box
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                    paddingY="2"
                >
                    <Box height="full" borderRight="grey-10" />
                </Box>
            )}
        </>
    );
}

function ContentEditorMobileKeyboardToolbarCommentButton({
    state,
    openCommentThread,
    onCommentInputOpen,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    openCommentThread: ((commentThreadId: DocumentCommentThreadId) => Promise<void>) | undefined;
    onCommentInputOpen: (setSelection?: TextSelection | null) => void;
}) {
    const {schema} = state;

    const commentSelection = useMemo(
        () =>
            schema.marks.comment
                ? expandSelectionAroundMark(state.doc, state.selection, "comment")
                : null,
        [schema, state],
    );

    const wordSelectionIfEmpty = useMemo(
        () =>
            // Disable the comment button when the user is continuously typing. So we don't
            // keep flashing the comment input on and off.
            !isContinuouslyTypingInContentEditor(state)
                ? expandEmptySelectionAroundWord(state.doc, state.selection)
                : null,
        [state],
    );

    return (
        <ContentEditorMobileKeyboardToolbarButton
            label="Comment"
            dividerLeft
            isActive={!!commentSelection}
            isDisabled={state.selection.from === state.selection.to && !wordSelectionIfEmpty}
            onPress={() => {
                if (commentSelection) {
                    void openCommentThread?.(
                        assertId<DocumentCommentThreadId>(
                            commentSelection.mark.attrs.commentThreadId,
                        ),
                    );
                    return;
                }

                onCommentInputOpen(
                    // Set the selection after the comment input opens so the mobile selection renderer
                    // doesn't flash in/out.
                    wordSelectionIfEmpty,
                );
            }}
        >
            <ChatCircleText />
        </ContentEditorMobileKeyboardToolbarButton>
    );
}

function fromCommand(viewRef: RefObject<EditorView | null>, command: Command): () => void {
    return () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch, view);
    };
}
