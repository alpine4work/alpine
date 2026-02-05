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
import {Command, EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useId, useMemo, useRef} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {ContentEditorMobileLinkModalState} from "~/client/web/content/internal/content_editor_mobile_link_modal.js";
import {getContentEditorMobileLinkModalSelectionSliceText} from "~/client/web/content/internal/get_content_editor_mobile_link_modal_selection_slice_text.js";
import {areAllNodesListItemType} from "~/client/web/content/internal/helpers/are_all_nodes_list_item_type.js";
import {createToggleListItemsCommand} from "~/client/web/content/internal/helpers/create_toggle_list_items_command.js";
import {expandEmptySelectionAroundWord} from "~/client/web/content/internal/helpers/expand_empty_selection_around_word.js";
import {expandSelectionAroundMark} from "~/client/web/content/internal/helpers/expand_selection_around_mark.js";
import {getMarksSpanningAcrossEntireRange} from "~/client/web/content/internal/helpers/get_marks_spanning_across_entire_range.js";
import {openContentEditorMentionFloaterMetaKey} from "~/client/web/content/state/content_editor_meta_keys.js";
import {getContentEditorReferences} from "~/client/web/content/state/content_editor_state.js";
import {createToggleMarkCommand} from "~/client/web/content/state/create_toggle_mark_command.js";
import {
    dedentListItemCommand,
    indentListItemCommand,
} from "~/client/web/content/state/indent_and_dedent_list_item_commands.js";
import {Box} from "~/client/web/design/box.js";
import {mobileBottomBarKeyboardToolbarHeight} from "~/client/web/design/mobile_bottom_bar.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * A keyboard toolbar that's basically the same as
 * `<ContentEditorMobileKeyboardToolbar>` but designed for use with
 * `<MessageInput>`. Lives in `~/client/content` instead of
 * `~/client/messaging` since we use internal content editor code.
 */
export function MessageInputMobileKeyboardToolbar({
    state,
    viewRef,
    isVisible,
    onLinkModalOpen,
    inputContainerRef,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    isVisible: boolean;
    onLinkModalOpen: (linkModalState: ContentEditorMobileLinkModalState) => void;
    inputContainerRef: RefObject<HTMLDivElement | null>;
}) {
    const {space} = useSpaceContext();

    const toolbarRef = useRef<HTMLDivElement>(null);

    const toolbarId = useId();

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

    return (
        <Box
            ref={toolbarRef}
            id={toolbarId}
            data-testid="MessageInputMobileKeyboardToolbar"
            height={mobileBottomBarKeyboardToolbarHeight}
            paddingX="0.5"
            display="flex"
            style={{pointerEvents: !isVisible ? "none" : undefined}}
        >
            <MessageInputMobileKeyboardToolbarButton
                dividerRight
                label="Insert"
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
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerLeft
                label="Bold"
                isActive={isBoldActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(state.schema.mark("bold")))}
            >
                <TextBolder />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                label="Italic"
                isActive={isItalicActive}
                onPress={fromCommand(viewRef, createToggleMarkCommand(state.schema.mark("italic")))}
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
                    const inputContainerElement = assertExists(inputContainerRef.current);

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
                        inputContainerElement.focus();
                    } else {
                        // For iOS Safari, move focus to a temporary, invisible, element so that when
                        // opening the link input the mobile keyboard stays open. The link modal will
                        // focus its link input after it mounts.
                        const temporaryInputElement = document.createElement("input");
                        temporaryInputElement.type = "text";
                        temporaryInputElement.style.width = "0";
                        temporaryInputElement.style.height = "0";
                        temporaryInputElement.style.margin = "0";
                        temporaryInputElement.style.padding = "0";
                        temporaryInputElement.style.border = "0";
                        temporaryInputElement.style.opacity = "0";
                        temporaryInputElement.style.position = "fixed";
                        temporaryInputElement.style.top = "0px";
                        inputContainerElement.appendChild(temporaryInputElement);
                        temporaryInputElement.addEventListener("blur", () => {
                            temporaryInputElement.parentElement?.removeChild(temporaryInputElement);
                        });
                        temporaryInputElement.focus();
                    }

                    const {text: selectionText, isEditable: isSelectionEditable} =
                        getContentEditorMobileLinkModalSelectionSliceText(
                            store => store.getSnapshot(),
                            space.id,
                            selection.content(),
                            getContentEditorReferences(view.state).references,
                        );

                    view.dispatch(view.state.tr.setSelection(selection));

                    const run = () => {
                        onLinkModalOpen({
                            initialText:
                                // If selection text is not editable, truncate it so our URL isn't too long.
                                !isSelectionEditable && selectionText.length > 80
                                    ? `${selectionText.slice(0, 80)}…`
                                    : selectionText,
                            isTextEditable: isSelectionEditable,
                            initialUrl: linkSelection?.mark.attrs?.url ?? "",
                        });
                    };

                    // In our mobile app, wait for the keyboard close animation to finish.
                    if (!NativeMobileBridge) {
                        run();
                    } else {
                        NativeMobileBridge.keyboard.scheduleAfterAnimation(run);
                    }
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
    const isPressedAndActive = useStateWithDependenciesWithoutDispatch(
        ([isPressed]) => isPressed && isActive,
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
                    color={isDisabled ? "grey-30" : isPressed || isActive ? "grey-100" : "grey-70"}
                    backgroundColor={
                        isPressedAndActive
                            ? "grey-20"
                            : isPressed || isActive
                              ? "grey-10"
                              : isHovered
                                ? "grey-5"
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

function fromCommand(viewRef: RefObject<EditorView | null>, command: Command): () => void {
    return () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch, view);
    };
}
