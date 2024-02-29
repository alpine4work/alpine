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
import {ReactNode, RefObject, useMemo} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {
    areAllNodesListItemType,
    createToggleListItemsCommand,
    createToggleMarkCommand,
    dedentListItemCommand,
    getMarksSpanningAcrossEntireRange,
    indentListItemCommand,
} from "~/client/content/internal/content_editor_prosemirror_helpers.js";
import {Box} from "~/client/design/box.js";
import {nativeMobileBottomBarKeyboardToolbarHeight} from "~/client/design/native_mobile_bottom_bar.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {spacing} from "~/shared/design/spacing.js";
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
}: {
    state: ContentEditorState<MessageContentWithReferences>;
    editorRef: RefObject<ContentEditorRef<MessageContentWithReferences>>;
}) {
    const state = stateProp._getInternalState();

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

    return (
        <Box height={nativeMobileBottomBarKeyboardToolbarHeight} paddingX="0.5" display="flex">
            <MessageInputMobileKeyboardToolbarButton
                dividerRight
                label="Mention"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                <At />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerLeft
                label="Bold"
                isActive={isBoldActive}
                onPress={fromCommand(editorRef, createToggleMarkCommand(state.schema.mark("bold")))}
            >
                <TextBolder />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                label="Italic"
                isActive={isItalicActive}
                onPress={fromCommand(
                    editorRef,
                    createToggleMarkCommand(state.schema.mark("italic")),
                )}
            >
                <TextItalic />
            </MessageInputMobileKeyboardToolbarButton>
            <MessageInputMobileKeyboardToolbarButton
                dividerRight
                label="Link"
                isActive={false}
                onPress={() => {
                    // NOCOMMIT: Implement
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
                        editorRef,
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
                        editorRef,
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
                        onPress={fromCommand(editorRef, dedentListItemCommand)}
                    >
                        <TextOutdent />
                    </MessageInputMobileKeyboardToolbarButton>
                    <MessageInputMobileKeyboardToolbarButton
                        label="Indent"
                        dividerRight
                        isActive={false}
                        isDisabled={!isIndentListItemEnabled}
                        onPress={fromCommand(editorRef, indentListItemCommand)}
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

function fromCommand(
    editorRef: RefObject<ContentEditorRef<MessageContentWithReferences>>,
    command: Command,
): () => void {
    return () => {
        const view = assertExists(editorRef.current)._getInternalView();
        command(view.state, view.dispatch.bind(view), view);
    };
}
