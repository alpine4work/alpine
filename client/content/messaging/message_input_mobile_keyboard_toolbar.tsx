import {
    At,
    IconContext,
    Link as LinkIcon,
    ListBullets,
    ListNumbers,
    TextBolder,
    TextIndent,
    TextItalic,
    TextOutdent,
} from "phosphor-react";
import {Command} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useEffect, useId, useMemo, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {
    ContentEditorState,
    getContentEditorReferences,
} from "~/client/content/content_editor_state.js";
import {
    ContentEditorMobileLinkMobileModal,
    ContentEditorMobileLinkMobileModalState,
    getContentEditorMobileLinkModalSelectionSliceText,
} from "~/client/content/internal/content_editor_mobile_link_mobile_modal.js";
import {openMentionFloaterMetaKey} from "~/client/content/internal/content_editor_plugin_input_rules.js";
import {areAllNodesListItemType} from "~/client/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleListItemsCommand} from "~/client/content/internal/helpers/create_toggle_list_items_command.js";
import {createToggleMarkCommand} from "~/client/content/internal/helpers/create_toggle_mark_command.js";
import {expandEmptySelectionAroundWord} from "~/client/content/internal/helpers/expand_empty_selection_around_word.js";
import {expandSelectionAroundMark} from "~/client/content/internal/helpers/expand_selection_around_mark.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/content/internal/helpers/indent_and_dedent_list_item_commands.js";
import {Box} from "~/client/design/box.js";
import {mobileBottomBarKeyboardToolbarHeight} from "~/client/design/mobile_bottom_bar.js";
import {MobileModal} from "~/client/design/mobile_modal.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {spacing} from "~/shared/design/spacing.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {waitMicrotask} from "~/shared/helpers/async/wait_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";

// NOCOMMIT: Haptic feedback when style is selected? This feels like a nice way
// to reward.

/**
 * A keyboard toolbar that's basically the same as
 * `<ContentEditorMobileKeyboardToolbar>` but designed for use with
 * `<MessageInput>`. Lives in `~/client/content` instead of
 * `~/client/messaging` since we use internal content editor code.
 */
export function MessageInputMobileKeyboardToolbar({
    state: stateProp,
    editorRef,
    isVisible,
}: {
    state: ContentEditorState<MessageContentWithReferences>;
    editorRef: RefObject<ContentEditorRef<MessageContentWithReferences>>;
    isVisible: boolean;
}) {
    const toolbarRef = useRef<HTMLDivElement>(null);
    const toolbarId = useId();

    const state = stateProp._getInternalState();

    const viewRef: RefObject<EditorView> = useMemo(
        () => ({
            get current() {
                return editorRef.current?._getInternalView() ?? null;
            },
        }),
        [editorRef],
    );

    const {isBoldActive, isItalicActive} = useMemo(() => {
        const marks = getMarksSpanningAcrossEntireRange(state.doc, state.selection);

        const boldMark = state.schema.mark("bold");
        const italicMark = state.schema.mark("italic");

        return {
            isBoldActive:
                boldMark.isInSet(marks) ||
                (!!state.storedMarks && boldMark.isInSet(state.storedMarks)),
            isItalicActive:
                italicMark.isInSet(marks) ||
                (!!state.storedMarks && italicMark.isInSet(state.storedMarks)),
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

    const isIndentListItemEnabled = useMemo(
        () =>
            (isUnorderedListItemActive || isOrderedListItemActive) && indentListItemCommand(state),
        [isOrderedListItemActive, isUnorderedListItemActive, state],
    );

    const isDedentListItemEnabled = useMemo(
        () =>
            (isUnorderedListItemActive || isOrderedListItemActive) && dedentListItemCommand(state),
        [isOrderedListItemActive, isUnorderedListItemActive, state],
    );

    const linkSelection = useMemo(
        () => expandSelectionAroundMark(state.doc, state.selection, "link"),
        [state],
    );

    const [linkModalState, setLinkModalState] =
        useState<ContentEditorMobileLinkMobileModalState | null>(null);

    const lastLinkModalStateRef = useRef(linkModalState);
    useEffect(() => {
        if (lastLinkModalStateRef.current === linkModalState) return;
        lastLinkModalStateRef.current = linkModalState;

        if (!linkModalState) {
            // Refocus the content editor after the modal is done closing.
            if (!NativeMobileBridge) {
                assertExists(viewRef.current).dom.focus();
            } else {
                // Focus after the navigation animation finishes. The keyboard can't open while
                // the navigation animation is running.
                NativeMobileBridge.navigation.scheduleAfterAnimation(() => {
                    assertExists(viewRef.current).dom.focus();
                });
            }
        }
    }, [linkModalState, viewRef]);

    return (
        <>
            <Box
                ref={toolbarRef}
                id={toolbarId}
                height={mobileBottomBarKeyboardToolbarHeight}
                paddingX="0.5"
                display="flex"
                // Focusable, but not by keyboard. Only by JavaScript.
                tabIndex={-1}
                style={{
                    transition: "opacity 200ms ease",
                    opacity: !isVisible ? "0" : undefined,
                    pointerEvents: !isVisible ? "none" : undefined,
                }}
            >
                <MessageInputMobileKeyboardToolbarButton
                    dividerRight
                    label="Mention"
                    isActive={false}
                    onPress={() => {
                        const view = assertExists(viewRef.current);
                        const {state} = view;
                        const schema = state.doc.type.schema;

                        view.dispatch(
                            state.tr
                                .replaceSelectionWith(schema.text("@"))
                                .setMeta(openMentionFloaterMetaKey, true),
                        );
                    }}
                >
                    <At />
                </MessageInputMobileKeyboardToolbarButton>
                <MessageInputMobileKeyboardToolbarButton
                    dividerLeft
                    label="Bold"
                    isActive={isBoldActive}
                    onPress={fromCommand(
                        viewRef,
                        createToggleMarkCommand(state.schema.mark("bold")),
                    )}
                >
                    <TextBolder />
                </MessageInputMobileKeyboardToolbarButton>
                <MessageInputMobileKeyboardToolbarButton
                    label="Italic"
                    isActive={isItalicActive}
                    onPress={fromCommand(
                        viewRef,
                        createToggleMarkCommand(state.schema.mark("italic")),
                    )}
                >
                    <TextItalic />
                </MessageInputMobileKeyboardToolbarButton>
                <MessageInputMobileKeyboardToolbarButton
                    dividerRight
                    label="Link"
                    isActive={!!linkSelection}
                    onPress={() => {
                        const selection =
                            linkSelection?.selection ??
                            expandEmptySelectionAroundWord(state.doc, state.selection) ??
                            state.selection;

                        const view = assertExists(viewRef.current);
                        const toolbarElement = assertExists(toolbarRef.current);

                        // In our native mobile app, blur the link modal input before animating the
                        // modal closed. In our web mobile app, we want to keep focus in a hidden input
                        // so the keyboard doesn't close.
                        //
                        // - In native mobile, even if we maintain focus in the DOM, iOS will do the
                        //   keyboard open/close animation. We might as well control the timing there.
                        //
                        // - In web mobile, the keyboard open/close animation is incredibly janky since
                        //   we don't have the same level of control as we do in native. So it feels
                        //   better to keep the keyboard open the whole time.
                        if (NativeMobileBridge) {
                            // Instead of calling `view.dom.blur()` which moves focus to `document.body`,
                            // we put focus on the toolbar element. That way
                            // `useConfirmSaveAfterLosingFocus()` (used for document comment editing) sees
                            // that focus stays inside the toolbar.
                            toolbarElement.focus();
                        } else {
                            // Move focus to a temporary, invisible, element so that when we change our
                            // view's selection the new selection doesn't render. However, we don't want to
                            // `blur()` since we want to keep the keyboard open while transitioning between
                            // views. To keep the keyboard open we move focus to another input. The link
                            // modal will focus its link input after it mounts.
                            const temporaryElement = document.createElement("input");
                            temporaryElement.style.width = "0";
                            temporaryElement.style.height = "0";
                            temporaryElement.style.margin = "0";
                            temporaryElement.style.padding = "0";
                            temporaryElement.style.border = "0";
                            temporaryElement.style.opacity = "0";
                            temporaryElement.style.position = "fixed";
                            temporaryElement.style.top = "0px";
                            toolbarElement.appendChild(temporaryElement);
                            temporaryElement.addEventListener("blur", () => {
                                toolbarElement.removeChild(temporaryElement);
                            });
                            temporaryElement.focus();
                        }

                        const {text: selectionText, isEditable: isSelectionEditable} =
                            getContentEditorMobileLinkModalSelectionSliceText(
                                selection.content(),
                                getContentEditorReferences(view.state).references,
                            );

                        view.dispatch(view.state.tr.setSelection(selection));

                        // In testing, iOS keyboard open/close animations take 250ms. In our mobile
                        // app, wait for the keyboard close animation to finish.
                        (NativeMobileBridge ? wait(250) : waitMicrotask()).finally(() => {
                            setLinkModalState({
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
                >
                    <LinkIcon />
                </MessageInputMobileKeyboardToolbarButton>
                {!isOrderedListItemActive && (
                    <MessageInputMobileKeyboardToolbarButton
                        label="Bullet list"
                        dividerLeft
                        isActive={isUnorderedListItemActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleListItemsCommand(state.schema.nodes.unorderedListItem),
                        )}
                    >
                        <ListBullets />
                    </MessageInputMobileKeyboardToolbarButton>
                )}
                {!isUnorderedListItemActive && (
                    <MessageInputMobileKeyboardToolbarButton
                        label="Number list"
                        dividerLeft={isOrderedListItemActive}
                        isActive={isOrderedListItemActive}
                        onPress={fromCommand(
                            viewRef,
                            createToggleListItemsCommand(state.schema.nodes.orderedListItem),
                        )}
                    >
                        <ListNumbers />
                    </MessageInputMobileKeyboardToolbarButton>
                )}
                {(isOrderedListItemActive || isUnorderedListItemActive) && (
                    <>
                        <MessageInputMobileKeyboardToolbarButton
                            label="Dedent"
                            isActive={false}
                            isDisabled={!isDedentListItemEnabled}
                            onPress={fromCommand(viewRef, dedentListItemCommand)}
                        >
                            <TextOutdent />
                        </MessageInputMobileKeyboardToolbarButton>
                        <MessageInputMobileKeyboardToolbarButton
                            label="Indent"
                            dividerRight
                            isActive={false}
                            isDisabled={!isIndentListItemEnabled}
                            onPress={fromCommand(viewRef, indentListItemCommand)}
                        >
                            <TextIndent />
                        </MessageInputMobileKeyboardToolbarButton>
                    </>
                )}
            </Box>
            {linkModalState && (
                <MobileModal
                    // Important: Tells `useConfirmSaveAfterLosingFocus()` (used by document comment
                    // input) that when focus is within the link modal we're still actually editing
                    // the comment input.
                    data-ownedby={toolbarId}
                    onClose={() => setLinkModalState(null)}
                >
                    {({onCloseWithAnimation}) => (
                        <ContentEditorMobileLinkMobileModal
                            viewRef={viewRef}
                            initialText={linkModalState.initialText}
                            isTextEditable={linkModalState.isTextEditable}
                            initialUrl={linkModalState.initialUrl}
                            onCloseWithAnimation={() => {
                                const toolbarElement = assertExists(toolbarRef.current);

                                // In our native mobile app, blur the link modal input before animating the
                                // modal closed. In our web mobile app, we want to keep focus in a hidden input
                                // so the keyboard doesn't close.
                                //
                                // - In native mobile, even if we maintain focus in the DOM, iOS will do the
                                //   keyboard open/close animation. We might as well control the timing there.
                                //
                                // - In web mobile, the keyboard open/close animation is incredibly janky since
                                //   we don't have the same level of control as we do in native. So it feels
                                //   better to keep the keyboard open the whole time.
                                if (NativeMobileBridge) {
                                    // Instead of blurring the link modal input, focus the toolbar element (which
                                    // has the same effect). That way `useConfirmSaveAfterLosingFocus()` (which we
                                    // use for document comment editing) sees that focus stays within the message
                                    // input.
                                    toolbarElement.focus();

                                    wait(250).finally(() => {
                                        onCloseWithAnimation();
                                    });
                                } else {
                                    // If there's currently an element with focus in the link modal, move focus to
                                    // a temporary, invisible, element to keep the keyboard open. Once we've
                                    // finished closing the modal then focus will return to the content editor.
                                    if (document.activeElement) {
                                        const temporaryElement = document.createElement("input");
                                        temporaryElement.style.width = "0";
                                        temporaryElement.style.height = "0";
                                        temporaryElement.style.margin = "0";
                                        temporaryElement.style.padding = "0";
                                        temporaryElement.style.border = "0";
                                        temporaryElement.style.opacity = "0";
                                        temporaryElement.style.position = "absolute";
                                        temporaryElement.style.top = "0px";
                                        toolbarElement.appendChild(temporaryElement);
                                        temporaryElement.addEventListener("blur", () => {
                                            toolbarElement.removeChild(temporaryElement);
                                        });
                                        temporaryElement.focus();
                                    }

                                    onCloseWithAnimation();
                                }
                            }}
                        />
                    )}
                </MobileModal>
            )}
        </>
    );
}

function MessageInputMobileKeyboardToolbarButton({
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
        // Toolbar buttons should not be focusable since we don't want the content
        // editor to lose focus.
        preventFocusOnPress: true,
        isDisabled,
        onPress,
    });

    const pressAndHoverProps = mergeProps(hoverProps, pressProps);

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <>
            {dividerLeft && (
                <Box
                    // We want all space on the toolbar to be touchable so the user doesn't touch
                    // and nothing happens (which can feel like a bug).
                    {...pressAndHoverProps}
                    // In case `pressAndHoverProps` had a `ref`, unset it.
                    ref={null}
                    height="full"
                    width="0.5"
                />
            )}
            <Box
                // None of this is focusable since it's used on mobile where there's no
                // keyboard navigation.
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
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-text" : "grey-70"}
                    backgroundColor={
                        isPressedAndActive
                            ? "grey-20"
                            : isPressed || isActive
                            ? "grey-10"
                            : isHovered
                            ? "grey-5"
                            : undefined
                    }
                    borderRadius="md"
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

function fromCommand(viewRef: RefObject<EditorView>, command: Command): () => void {
    return () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch.bind(view), view);
    };
}
