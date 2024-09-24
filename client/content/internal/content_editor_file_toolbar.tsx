import {
    AlignCenterHorizontalSimple,
    AlignLeftSimple,
    AlignRightSimple,
    ChatCircleText,
    IconContext,
    UploadSimple,
} from "phosphor-react";
import {Fragment, Node, Slice} from "prosemirror-model";
import {Command, EditorState, NodeSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {ReactNode, RefObject, useEffect, useMemo, useRef, useState} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {getContentEditorReferences} from "~/client/content/content_editor_state.js";
import {openCommentInputFloaterMetaKey} from "~/client/content/internal/build_content_editor_keymap_plugin.js";
import {ContentEditorFloaterState} from "~/client/content/internal/content_editor_floater_state.js";
import {Box} from "~/client/design/box.js";
import {useIsContextMenuOpen} from "~/client/design/context_menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {ImagesIcon} from "~/client/icons/images_icon.js";
import {
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    sprinkles,
} from "~/client/styles/styles.js";
import {ContentProsemirrorSchema} from "~/shared/content/content_schema.js";
import {spacing} from "~/shared/design/spacing.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import {FileId} from "~/shared/id/types/id_types.js";

let isDisablingContentEditorFileToolbarInitialAnimation = false;

export function withDisableContentEditorFileToolbarInitialAnimation(action: () => void) {
    try {
        isDisablingContentEditorFileToolbarInitialAnimation = true;
        action();
    } finally {
        isDisablingContentEditorFileToolbarInitialAnimation = false;
    }
}

export function ContentEditorFileToolbarController({
    state,
    viewRef,
    floaterState,
    selectedNodeElement,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView>;
    floaterState: ContentEditorFloaterState;
    selectedNodeElement: HTMLElement | null;
}) {
    const [fileToolbar, setFileToolbar] = useState<{
        key: string;
        doc: Node;
        selection: NodeSelection;
        targetElement: HTMLElement;
        isDisablingInitialAnimation: boolean;
    } | null>(null);

    const isFileToolbarVisible: boolean =
        !!selectedNodeElement &&
        floaterState.type === "PointerToolbar" &&
        state.selection instanceof NodeSelection &&
        state.selection.node.type.name === "file";

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

    useEffect(() => {
        if (!isFileToolbarVisible && hasFileToolbar) {
            const timeout = createTimeout(() => {
                setFileToolbar(null);
            }, overlayFadeOutAnimationDurationMs);
            return () => timeout.clear();
        }
    }, [hasFileToolbar, isFileToolbarVisible]);

    return fileToolbar ? (
        <ContentEditorFileToolbar
            // Completely remount the component whenever the selected node changes.
            key={fileToolbar.key}
            state={state}
            viewRef={viewRef}
            isVisible={isFileToolbarVisible}
            selection={fileToolbar.selection}
            targetElement={fileToolbar.targetElement}
            isDisablingInitialAnimation={fileToolbar.isDisablingInitialAnimation}
        />
    ) : null;
}

function ContentEditorFileToolbar({
    state,
    viewRef,
    isVisible,
    selection,
    targetElement,
    isDisablingInitialAnimation: isDisablingInitialAnimationFromProps,
}: {
    state: EditorState & {schema: ContentProsemirrorSchema};
    viewRef: RefObject<EditorView>;
    isVisible: boolean;
    selection: NodeSelection;
    targetElement: HTMLElement;
    isDisablingInitialAnimation: boolean;
}) {
    const hasAlignmentButtons =
        state.schema.nodes.fileFloat &&
        ((selection.$anchor.parent.type.name === "fileRow" &&
            selection.$anchor.parent.childCount === 1) ||
            selection.$anchor.parent.type.name === "fileFloat");

    const references = getContentEditorReferences(state).references;

    const file = useMemo(() => {
        const fileId: FileId | null | undefined = selection.node.attrs.fileId;
        return fileId ? references.fileById.get(fileId) : undefined;
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
            overlay={
                <Box
                    display="flex"
                    paddingLeft="1"
                    paddingRight="0.5"
                    color="grey-100"
                    backgroundColor="grey-0"
                    borderRadius="1.5"
                    boxShadow="elevation-20"
                    className={greyElevated2ClassName}
                >
                    {hasAlignmentButtons && (
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
                                            transaction.setSelection(
                                                new NodeSelection(
                                                    transaction.doc.resolve(
                                                        selection.$anchor.before() + 1,
                                                    ),
                                                ),
                                            ),
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
                                            transaction.setSelection(
                                                new NodeSelection(
                                                    transaction.doc.resolve(
                                                        selection.$anchor.before() + 1,
                                                    ),
                                                ),
                                            ),
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
                                            transaction.setSelection(
                                                new NodeSelection(
                                                    transaction.doc.resolve(
                                                        selection.$anchor.before() + 1,
                                                    ),
                                                ),
                                            ),
                                        );
                                    }

                                    return true;
                                }}
                            >
                                <AlignRightSimple />
                            </ContentEditorFileToolbarButton>
                        </>
                    )}
                    {selection.$anchor.parent.type.name === "fileRow" && (
                        <ContentEditorFileToolbarButton
                            dividerLeft={hasAlignmentButtons}
                            description={`Add another ${getFileContentTypeNoun(file?.contentType)}`}
                            viewRef={viewRef}
                            isActive={false}
                            command={() => {
                                // TODO(calebmer, #files): Implement!
                                return false;
                            }}
                        >
                            <ImagesIcon />
                        </ContentEditorFileToolbarButton>
                    )}
                    <ContentEditorFileToolbarButton
                        dividerLeft={
                            hasAlignmentButtons && selection.$anchor.parent.type.name !== "fileRow"
                        }
                        dividerRight={!!state.schema.marks.comment}
                        description={`Replace ${getFileContentTypeNoun(file?.contentType)}`}
                        viewRef={viewRef}
                        isActive={false}
                        command={() => {
                            // TODO(calebmer, #files): Implement!
                            return false;
                        }}
                    >
                        <UploadSimple />
                    </ContentEditorFileToolbarButton>
                    {state.schema.marks.comment && (
                        <ContentEditorFileToolbarButton
                            dividerLeft={true}
                            // Intentionally not rendering keyboard shortcut since "Comment" is the only
                            // option that supports a keyboard shortcut. Only showing a keyboard shortcut
                            // on this one button's tooltip would look weird.
                            description="Comment"
                            viewRef={viewRef}
                            isActive={false}
                            command={(state, dispatch) => {
                                dispatch?.(state.tr.setMeta(openCommentInputFloaterMetaKey, true));
                                return true;
                            }}
                        >
                            <ChatCircleText />
                        </ContentEditorFileToolbarButton>
                    )}
                </Box>
            }
        />
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
    description: string;
    viewRef: RefObject<EditorView | null>;
    isActive: boolean;
    command: Command;
    children: ReactNode;
    dividerLeft?: boolean;
    dividerRight?: boolean;
}) {
    const onPress = () => {
        const view = assertExists(viewRef.current);
        command(view.state, view.dispatch.bind(view), view);
    };

    const localRef = useRef<HTMLDivElement>(null);

    const {pressProps, isPressed} = usePress({
        ref: localRef,
        preventFocusOnPress: true,
        onPress,
    });

    const {hoverProps, isHovered} = useHover({});

    // Change this state only when `isPressed` changes. If it becomes active while
    // pressed we don't want to change the color.
    const [isPressedAndActive] = useStateWithDependencies(
        (isPressed: boolean) => isPressed && isActive,
        [isPressed],
    );

    return (
        <Tooltip
            placement="top"
            // Don't allow flipping the tooltip down into selection content.
            fallbackPlacements={emptyArray}
            content={description}
        >
            <div
                {...mergeProps(pressProps, hoverProps)}
                ref={localRef}
                aria-label={description}
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
                        padding="1"
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
                                size: spacing["4"],
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

/**
 * Get a user friendly noun for the file content type. For example a `.png`
 * file will be called "image".
 */
function getFileContentTypeNoun(contentType: FileContentType | undefined): string {
    switch (contentType) {
        case "image/apng":
        case "image/avif":
        case "image/gif":
        case "image/jpeg":
        case "image/png":
        case "image/svg+xml":
        case "image/webp":
        case "image/bmp":
        case "image/ico":
        case "image/tiff":
        case "image/heif":
            return "image";
        case "video/webm":
        case "video/mp4":
        case "video/quicktime":
        case "video/mpeg":
        case "video/x-matroska":
            return "video";
        case "audio/mpeg":
        case "audio/wav":
        case "audio/webm":
        case "audio/ogg":
        case "audio/mp4":
            return "audio";
        case undefined:
        case "application/octet-stream":
        case "application/pdf":
        case "application/msword":
        case "application/vnd.ms-excel":
        case "application/vnd.ms-powerpoint":
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        case "text/plain":
        case "text/javascript":
        case "text/html":
        case "text/css":
        case "application/sql":
        case "text/x-python":
        case "text/x-typescript":
        case "application/x-sh":
        case "text/x-java":
        case "application/json":
        case "text/markdown":
        case "text/x-csharp":
        case "text/x-c++src":
        case "text/x-csrc":
        case "application/x-httpd-php":
        case "text/x-go":
        case "application/yaml":
        case "application/x-powershell":
        case "text/rust":
        case "text/x-kotlin":
        case "application/x-ruby":
        case "text/x-lua":
        case "application/xml":
        case "application/vnd.dart":
        case "text/x-swift":
        case "text/x-asm":
        case "application/wasm":
        case "text/x-scala":
        case "text/x-r":
        case "text/x-elixir":
        case "text/x-objcsrc":
        case "text/x-perl":
        case "text/x-haskell":
        case "text/x-solidity":
        case "text/x-clojure":
        case "text/x-erlang":
        case "text/x-ocaml":
            return "file";
        default:
            throw exhaustive(contentType);
    }
}
