import {
    AlignCenterHorizontalSimple,
    AlignLeftSimple,
    AlignRightSimple,
    ChatCircleText,
    IconContext,
    Swap,
    Trash,
} from "phosphor-react";
import {Fragment, Node, Slice} from "prosemirror-model";
import {Command, EditorState, NodeSelection, Selection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useEffect, useId, useMemo, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {selectFiles} from "~/client/web/content/select_files.js";
import {ContentEditorFloaterState} from "~/client/web/content/state/content_editor_floater_state.js";
import {openContentEditorCommentInputFloaterMetaKey} from "~/client/web/content/state/content_editor_meta_keys.js";
import {getContentEditorReferences} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {useIsContextMenuOpen} from "~/client/web/design/context_menu.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {overlayFadeOutAnimationDurationMs, sprinkles} from "~/client/web/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {getFileContentTypeNoun} from "~/shared/files/get_file_content_type_noun.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId, isId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

let isDisablingContentEditorFileToolbarInitialAnimation = false;

ContentEditorFileToolbarController.withDisableInitialAnimation = (action: () => void) => {
    try {
        isDisablingContentEditorFileToolbarInitialAnimation = true;
        action();
    } finally {
        isDisablingContentEditorFileToolbarInitialAnimation = false;
    }
};

export function ContentEditorFileToolbarController({
    state,
    viewRef,
    isFocused,
    accessLevel,
    floaterState,
    selectedNodeElement,
    hasFileDropTarget,
    onInsertFiles,
    onMobileCommentInputOpen,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    isFocused: boolean;
    accessLevel: AccessLevel;
    floaterState: ContentEditorFloaterState;
    selectedNodeElement: HTMLElement | null;
    hasFileDropTarget: boolean;
    onInsertFiles: (posOrSelection: Selection | number, files: ReadonlyArray<File>) => void;
    onMobileCommentInputOpen: () => void;
}) {
    const [fileToolbar, setFileToolbar] = useState<{
        key: string;
        doc: Node;
        selection: NodeSelection;
        targetElement: HTMLElement;
        isDisablingInitialAnimation: boolean;
    } | null>(null);

    // Put a small delay on when the file toolbar is visible after the content
    // editor has been focused in case the content editor is immediately unfocused.
    // This happens on `pointerdown` for a file. See `handlePointerDown` in
    // `addContentFilePreviewBehaviorBase`. On `handlePointerDown` the browser by
    // default focuses the content editable, but we don't want that if the user is
    // only clicking to expand a file. So we call `blur()` after
    // `requestAnimationFrame()`.
    const isFocusedWithDelay = useDelayLoadingIndicator(isFocused, perceivedAsInstantLimitMs);

    const isFileToolbarVisible: boolean =
        isFocusedWithDelay &&
        !!selectedNodeElement &&
        floaterState.type === "PointerToolbar" &&
        state.selection instanceof NodeSelection &&
        state.selection.node.type.name === "file" &&
        !hasFileDropTarget &&
        hasAccessLevel(accessLevel, "Comment");

    if (
        isFileToolbarVisible &&
        !!selectedNodeElement &&
        state.selection instanceof NodeSelection &&
        (!fileToolbar ||
            fileToolbar.selection !== state.selection ||
            fileToolbar.targetElement !== selectedNodeElement)
    ) {
        setFileToolbar({
            key:
                fileToolbar && fileToolbar.targetElement === selectedNodeElement
                    ? fileToolbar.key
                    : generateId(),
            doc: state.doc,
            selection: state.selection,
            targetElement: selectedNodeElement,
            // Don't animate if we already had a `fileToolbar` with a different element.
            isDisablingInitialAnimation:
                !!fileToolbar && fileToolbar.targetElement !== selectedNodeElement,
        });
    }

    const hasFileToolbar = !!fileToolbar;
    const [showDeleteConfirmationDialog, setShowDeleteConfirmationDialog] = useState(false);

    useEffect(() => {
        // Don't unmount the toolbar while the delete confirmation dialog is showing
        if (!isFileToolbarVisible && hasFileToolbar && !showDeleteConfirmationDialog) {
            const timeout = createTimeout(() => {
                setFileToolbar(null);
            }, overlayFadeOutAnimationDurationMs);
            return () => timeout.clear();
        }
    }, [hasFileToolbar, isFileToolbarVisible, showDeleteConfirmationDialog]);

    return fileToolbar ? (
        <ContentEditorFileToolbar
            // Completely remount the component whenever the selected node changes.
            key={fileToolbar.key}
            state={state}
            viewRef={viewRef}
            accessLevel={accessLevel}
            isVisible={isFileToolbarVisible}
            selection={fileToolbar.selection}
            targetElement={fileToolbar.targetElement}
            isDisablingInitialAnimation={fileToolbar.isDisablingInitialAnimation}
            onInsertFiles={onInsertFiles}
            onMobileCommentInputOpen={onMobileCommentInputOpen}
            showDeleteConfirmationDialog={showDeleteConfirmationDialog}
            setShowDeleteConfirmationDialog={setShowDeleteConfirmationDialog}
        />
    ) : null;
}

function ContentEditorFileToolbar({
    state,
    viewRef,
    accessLevel,
    isVisible,
    selection,
    targetElement,
    isDisablingInitialAnimation: isDisablingInitialAnimationFromProps,
    onInsertFiles,
    onMobileCommentInputOpen,
    showDeleteConfirmationDialog,
    setShowDeleteConfirmationDialog,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView | null>;
    accessLevel: AccessLevel;
    isVisible: boolean;
    selection: NodeSelection;
    targetElement: HTMLElement;
    isDisablingInitialAnimation: boolean;
    onInsertFiles: (posOrSelection: Selection | number, files: ReadonlyArray<File>) => void;
    onMobileCommentInputOpen: () => void;
    showDeleteConfirmationDialog: boolean;
    setShowDeleteConfirmationDialog: (show: boolean) => void;
}) {
    const platform = usePlatform();

    const toolbarRef = useRef<HTMLDivElement>(null);
    const toolbarId = useId();

    const selectionRef = useRef<NodeSelection | null>(null);

    useEffect(() => {
        selectionRef.current = selection;
        return () => {
            selectionRef.current = null;
        };
    }, [selection]);

    const hasEditAccessLevel = hasAccessLevel(accessLevel, "Edit");

    // Don't render the replace button for file entities. It would be weird to open
    // a file selector when clicking the replace button on a file entity.
    const hasReplaceButton =
        !selection.node.attrs.fileId || isId<FileId>(selection.node.attrs.fileId);

    const hasAlignmentButtons =
        state.schema.nodes.fileFloat &&
        ((selection.$anchor.parent.type.name === "fileRow" &&
            selection.$anchor.parent.childCount === 1) ||
            selection.$anchor.parent.type.name === "fileFloat");

    const references = getContentEditorReferences(state).references;

    const {deleteVerb, entityNoun} = useMemo(() => {
        const fileId: FileId | FileEntityId | null | undefined = selection.node.attrs.fileId;

        if (!fileId) {
            const entityNoun = getFileContentTypeNoun(undefined);
            return {deleteVerb: "Delete", entityNoun};
        } else if (isId<FileId>(fileId)) {
            const entityNoun = getFileContentTypeNoun(
                references.fileById?.get(fileId)?.file.contentType,
            );
            return {deleteVerb: "Delete", entityNoun};
        } else {
            const fileIdObject = parseFileEntityId(fileId);
            const entityNoun = getFileEntityNoun(fileIdObject.type);

            // Use a softer verb than "Delete". Since you're not "deleting a document" when
            // you select the delete option, rather you're removing a document embed from
            // the content.
            return {deleteVerb: "Remove", entityNoun};
        }
    }, [references.fileById, selection.node.attrs.fileId]);

    const isContextMenuOpen = useIsContextMenuOpen();
    const [isDisablingInitialAnimation, setIsDisablingInitialAnimation] = useState(
        isDisablingInitialAnimationFromProps || isDisablingContentEditorFileToolbarInitialAnimation,
    );

    useEffect(() => {
        if (!isDisablingInitialAnimation) return;
        setIsDisablingInitialAnimation(false);
    }, [isDisablingInitialAnimation]);

    return (
        <>
            <OverlayAnimated
                isVisible={isVisible && !isContextMenuOpen}
                disableAnimation={isDisablingInitialAnimation}
                placement="top"
                // It doesn't make sense for the toolbar to flip. Since if it's over a range of
                // text it'll always be at the beginning of the text. Always make sure the
                // `<ContentEditor>` has some space above it so the toolbar will never go
                // offscreen.
                fallbackPlacements={emptyArray}
                offset="4"
                targetElement={targetElement}
                // Render above `<FocusRing>` overlays. For example, the `<FocusRing>` overlay
                // around a post when editing content on desktop.
                overlayZIndex="10"
                overlay={
                    <Box
                        ref={toolbarRef}
                        id={toolbarId}
                        display="flex"
                        paddingLeft="1"
                        paddingRight="0.5"
                        color="grey-100"
                        backgroundColor="grey-0"
                        borderRadius="1.5"
                        boxShadow="elevation-20"
                        className={greyElevated2ClassName}
                    >
                        {hasEditAccessLevel && hasAlignmentButtons && (
                            <>
                                <ContentEditorFileToolbarButton
                                    description="Align left"
                                    viewRef={viewRef}
                                    isActive={
                                        selection.$anchor.parent.type.name === "fileFloat" &&
                                        selection.$anchor.parent.attrs.direction === "left"
                                    }
                                    command={(state, dispatch) => {
                                        const {selection} = state;

                                        if (
                                            !(selection instanceof NodeSelection) ||
                                            (selection.$anchor.parent.type.name === "fileFloat" &&
                                                selection.$anchor.parent.attrs.direction === "left")
                                        ) {
                                            return false;
                                        }

                                        if (selection.$anchor.parent.type.name === "fileFloat") {
                                            dispatch?.(
                                                state.tr.setNodeAttribute(
                                                    selection.anchor - 1,
                                                    "direction",
                                                    "left",
                                                ),
                                            );
                                        } else if (dispatch) {
                                            const transaction = state.tr.replace(
                                                selection.$anchor.before(),
                                                selection.$anchor.end(),
                                                new Slice(
                                                    Fragment.from(
                                                        state.schema.node(
                                                            "fileFloat",
                                                            {direction: "left"},
                                                            [selection.node],
                                                        ),
                                                    ),
                                                    0,
                                                    0,
                                                ),
                                            );

                                            dispatch(
                                                transaction
                                                    .setSelection(
                                                        new NodeSelection(
                                                            transaction.doc.resolve(
                                                                selection.$anchor.before() + 1,
                                                            ),
                                                        ),
                                                    )
                                                    // Scroll into view here is important since otherwise ProseMirror will try to
                                                    // preserve the scroll position using the NEXT element as a reference. The next
                                                    // element will likely move when converting a file between floating and center
                                                    // aligned so we don't want that.
                                                    .scrollIntoView(),
                                            );
                                        }

                                        return true;
                                    }}
                                >
                                    <AlignLeftSimple />
                                </ContentEditorFileToolbarButton>
                                <ContentEditorFileToolbarButton
                                    description="Align center"
                                    viewRef={viewRef}
                                    isActive={selection.$anchor.parent.type.name === "fileRow"}
                                    command={(state, dispatch) => {
                                        const {selection} = state;

                                        if (
                                            !(selection instanceof NodeSelection) ||
                                            selection.$anchor.parent.type.name === "fileRow"
                                        ) {
                                            return false;
                                        }

                                        if (dispatch) {
                                            const transaction = state.tr.replace(
                                                selection.$anchor.before(),
                                                selection.$anchor.end(),
                                                new Slice(
                                                    Fragment.from(
                                                        state.schema.node("fileRow", {}, [
                                                            selection.node,
                                                        ]),
                                                    ),
                                                    0,
                                                    0,
                                                ),
                                            );

                                            dispatch(
                                                transaction
                                                    .setSelection(
                                                        new NodeSelection(
                                                            transaction.doc.resolve(
                                                                selection.$anchor.before() + 1,
                                                            ),
                                                        ),
                                                    )
                                                    // Scroll into view here is important since otherwise ProseMirror will try to
                                                    // preserve the scroll position using the NEXT element as a reference. The next
                                                    // element will likely move when converting a file between floating and center
                                                    // aligned so we don't want that.
                                                    .scrollIntoView(),
                                            );
                                        }

                                        return true;
                                    }}
                                >
                                    <AlignCenterHorizontalSimple />
                                </ContentEditorFileToolbarButton>
                                <ContentEditorFileToolbarButton
                                    dividerRight={true}
                                    description="Align right"
                                    viewRef={viewRef}
                                    isActive={
                                        selection.$anchor.parent.type.name === "fileFloat" &&
                                        selection.$anchor.parent.attrs.direction !== "left"
                                    }
                                    command={(state, dispatch) => {
                                        const {selection} = state;

                                        if (
                                            !(selection instanceof NodeSelection) ||
                                            (selection.$anchor.parent.type.name === "fileFloat" &&
                                                selection.$anchor.parent.attrs.direction !== "left")
                                        ) {
                                            return false;
                                        }

                                        if (selection.$anchor.parent.type.name === "fileFloat") {
                                            dispatch?.(
                                                state.tr.setNodeAttribute(
                                                    selection.anchor - 1,
                                                    "direction",
                                                    "right",
                                                ),
                                            );
                                        } else if (dispatch) {
                                            const transaction = state.tr.replace(
                                                selection.$anchor.before(),
                                                selection.$anchor.end(),
                                                new Slice(
                                                    Fragment.from(
                                                        state.schema.node(
                                                            "fileFloat",
                                                            {direction: "right"},
                                                            [selection.node],
                                                        ),
                                                    ),
                                                    0,
                                                    0,
                                                ),
                                            );

                                            dispatch(
                                                transaction
                                                    .setSelection(
                                                        new NodeSelection(
                                                            transaction.doc.resolve(
                                                                selection.$anchor.before() + 1,
                                                            ),
                                                        ),
                                                    )
                                                    // Scroll into view here is important since otherwise ProseMirror will try to
                                                    // preserve the scroll position using the NEXT element as a reference. The next
                                                    // element will likely move when converting a file between floating and center
                                                    // aligned so we don't want that.
                                                    .scrollIntoView(),
                                            );
                                        }

                                        return true;
                                    }}
                                >
                                    <AlignRightSimple />
                                </ContentEditorFileToolbarButton>
                            </>
                        )}
                        {hasEditAccessLevel && (
                            <>
                                {hasReplaceButton && (
                                    <ContentEditorFileToolbarButton
                                        dividerLeft={hasAlignmentButtons}
                                        description={`Replace ${entityNoun}`}
                                        viewRef={viewRef}
                                        isActive={false}
                                        command={() => {
                                            const toolbarElement = assertExists(toolbarRef.current);

                                            selectFiles(toolbarElement, {
                                                multiple: false,
                                            })
                                                .then(files => {
                                                    if (files.length !== 1) return;

                                                    // If the component unmounted while we were waiting on a selection then don't
                                                    // try replacing this file.
                                                    if (!selectionRef.current) return;

                                                    onInsertFiles(selectionRef.current, [
                                                        files[0]!,
                                                    ]);
                                                })
                                                .catch(scheduleUncaughtError);

                                            return true;
                                        }}
                                    >
                                        <Swap />
                                    </ContentEditorFileToolbarButton>
                                )}
                                <ContentEditorFileToolbarButton
                                    dividerLeft={!hasReplaceButton && hasAlignmentButtons}
                                    dividerRight={!!state.schema.marks.comment}
                                    description={`${deleteVerb} ${entityNoun}`}
                                    viewRef={viewRef}
                                    isActive={false}
                                    command={() => {
                                        setShowDeleteConfirmationDialog(true);
                                        return true;
                                    }}
                                >
                                    <Trash />
                                </ContentEditorFileToolbarButton>
                            </>
                        )}
                        {state.schema.marks.comment && (
                            <ContentEditorFileToolbarButton
                                dividerLeft={hasEditAccessLevel}
                                // Intentionally not rendering keyboard shortcut since "Comment" is the only
                                // option that supports a keyboard shortcut. Only showing a keyboard shortcut
                                // on this one button's tooltip would look weird.
                                description={hasEditAccessLevel ? "Comment" : null}
                                viewRef={viewRef}
                                isActive={false}
                                command={(state, dispatch) => {
                                    if (platform === "mobile") {
                                        onMobileCommentInputOpen();
                                    } else {
                                        dispatch?.(
                                            state.tr.setMeta(
                                                openContentEditorCommentInputFloaterMetaKey,
                                                true,
                                            ),
                                        );
                                    }
                                    return true;
                                }}
                            >
                                {hasEditAccessLevel ? (
                                    <ChatCircleText />
                                ) : (
                                    <Box display="flex" gap="1">
                                        <ChatCircleText />
                                        <Box color="grey-100">Comment</Box>
                                    </Box>
                                )}
                            </ContentEditorFileToolbarButton>
                        )}
                    </Box>
                }
            />
            {showDeleteConfirmationDialog && (
                <ModalDialog
                    data-ownedby={toolbarId}
                    title={`${deleteVerb} ${entityNoun}?`}
                    description="You can undo this change at any time."
                    onClose={() => setShowDeleteConfirmationDialog(false)}
                    primaryButtonLabel={deleteVerb}
                    onPrimaryButtonPress={() => {
                        const view = assertExists(viewRef.current);
                        view.dispatch(view.state.tr.deleteSelection());
                    }}
                />
            )}
        </>
    );
}

function ContentEditorFileToolbarButton({
    description,
    viewRef,
    isActive,
    command,
    children,
    dividerLeft,
    dividerRight,
}: {
    description: string | null;
    viewRef: RefObject<EditorView | null>;
    isActive: boolean;
    command: Command;
    children: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const platform = usePlatform();

    const onPress = () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch, view);
    };

    const localRef = useRef<HTMLDivElement>(null);

    const {pressProps, isPressed} = usePress({
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        ref: localRef,
        preventFocusOnPress: true,
        onPress,
    });

    const {hoverProps, isHovered} = useHover({});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const isPressedAndActive = useStateWithDependenciesWithoutDispatch(
        ([isPressed]) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip
            isDisabled={description === null}
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            fallbackPlacements={emptyArray}
            content={description}
        >
            <div
                {...mergeProps(pressProps, hoverProps)}
                ref={localRef}
                aria-label={description ?? undefined}
                // Disable the ability to focus this icon button! The icon buttons in the
                // selection toolbar are only mouse accessible. They are not keyboard
                // accessible. By being focusable then the button steals focus when you click
                // on it, so instead make the button not focusable. This also makes it so the
                // button is not reachable in tab order.
                tabIndex={undefined}
                className={sprinkles({
                    paddingY: "1",
                    // You may notice our button doesn't have a pointer cursor. See:
                    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
                    cursor: "default",
                })}
            >
                <Box
                    // We implement dividers in this funky way so that as the mouse scrubs left and
                    // right over our toolbar the tooltips immediately disappear/reappear because
                    // there is no gap in between the hovered elements.
                    paddingRight={dividerRight ? "1" : "0.5"}
                    borderRight={dividerRight ? "grey-5" : undefined}
                    paddingLeft={dividerLeft ? "1" : undefined}
                >
                    <Box
                        padding={platform === "mobile" ? "2" : "1"}
                        borderRadius="1"
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
                        <IconContext.Provider
                            value={{
                                color: "currentColor",
                                size: spacing[platform === "mobile" ? "5" : "4"],
                            }}
                        >
                            {children}
                        </IconContext.Provider>
                    </Box>
                </Box>
            </div>
        </Tooltip>
    );
}
