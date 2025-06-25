import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {Node} from "prosemirror-model";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {renderContentFileErrorPreview} from "~/client/content/internal/content_file_error_preview.js";
import {
    addContentFilePreviewBehaviorBase,
    appendImageHtmlForSelection,
    appendSelectionBoundaryHtml,
} from "~/client/content/internal/content_file_preview.js";
import {ContentFileLayout} from "~/client/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/context/app_context.js";
import {addContextMenuActions} from "~/client/design/context_menu.js";
import {defaultErrorDisplayMessage} from "~/client/design/default_error_display_message.js";
import {Reporter} from "~/client/design/reporter.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {NavigateFunction} from "~/client/remix/use_navigate.js";
import {contentStyles} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {ErrorBase, InternalError, NotFoundError, UnimplementedError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {
    FileEntityId,
    parseFileEntityId,
    printFileEntityIdIntoPath,
} from "~/shared/files/file_entity_id.js";
import {fileEntityMaxRecursionDepth} from "~/shared/files/file_entity_max_recursion_depth.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {ClientInfo} from "~/shared/remix/client_info.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

let reportedErrors: WeakSet<object> | null = null;
let fallbackErrorByNode: WeakMap<Node, ErrorBase> | null = null;

let depth = 0;

/**
 * Render the provided `file` node to an `HtmlElementGenerator`. This
 * `HtmlElementGenerator` can either be used to render `<ContentEditor>` or
 * `<ContentView>`.
 *
 * Unlike `renderContentFilePreview()` this only renders file entities. The
 * implementation of each file entity renderer needs to be injected through
 * dependency injection (we use React context for this) since the package
 * we're in (`//client/content`) can't depend on all other UI code across our
 * codebase (e.g. `//client/tasks` and `//client/documents`).
 */
export function renderContentFileEntityPreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        node,
        fileEntityId,
        fileEntityResult,
        fileEntityRenderers,
        layout,
        getContext,
        clientInfo,
        spaceId,
        accountRegistry,
        fileRegistry,
        currentAccount,
        blockWidth,
        transformScale,
        platform,
        spacingScale,
        isInitialAppRender,
        currentDate,
    }: {
        node: Node;
        fileEntityId: FileEntityId;
        fileEntityResult: Result<FileEntityModel> | undefined;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        layout: ContentFileLayout;
        getContext: () => AppContext;
        clientInfo: ClientInfo;
        spaceId: SpaceId | null;
        accountRegistry: AccountRegistry;
        fileRegistry: FileRegistry;
        currentAccount: AccountModel | null;
        blockWidth: number;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
    },
): HtmlElementGenerator {
    assert(node.type.name === "file");

    const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));

    assert(html instanceof HtmlElementGenerator);

    html.setAttribute(
        "class",
        classNames(html.getAttribute("class"), contentStyles.fileEntityClassName),
    );

    appendSelectionBoundaryHtml(html);
    appendImageHtmlForSelection(html, platform);

    if (depth >= fileEntityMaxRecursionDepth && !fileEntityResult) {
        // If we've hit the max depth where the backend stops loading file entities to
        // prevent infinite recursion then instead of rendering an error message,
        // render nothing.
    } else if (!fileEntityRenderers || !fileEntityResult?.ok) {
        const fileEntityIdObject = parseFileEntityId(fileEntityId);
        const entityNoun = getFileEntityNoun(fileEntityIdObject.type);

        const error =
            fileEntityResult?.error ??
            getOrSetDefaultMapValue((fallbackErrorByNode ??= new WeakMap()), node, () =>
                !fileEntityRenderers
                    ? new InternalError("File entity renderers weren’t provided")
                    : new NotFoundError("File entity not found in content references"),
            );

        if (!reportedErrors?.has(error)) {
            (reportedErrors ??= new WeakSet()).add(error);
            getContext().react.reportRenderedError(error);
        }

        const isNotFoundError: boolean =
            error instanceof ErrorBase &&
            error.code === ErrorCode.NotFound &&
            !!error.displayMessage;

        const isPermissionDeniedError: boolean =
            error instanceof ErrorBase &&
            error.code === ErrorCode.PermissionDenied &&
            !!error.displayMessage;

        html.appendChild(
            renderContentFileErrorPreview({
                layout,
                icon: isNotFoundError ? "Trash" : isPermissionDeniedError ? "Lock" : "Warning",
                title: isNotFoundError
                    ? `Couldn’t find ${entityNoun}`
                    : isPermissionDeniedError
                    ? `Private ${entityNoun}`
                    : `Couldn’t preview ${entityNoun}`,
                displayMessage:
                    error instanceof ErrorBase
                        ? error.displayMessage ?? defaultErrorDisplayMessage
                        : defaultErrorDisplayMessage,
                platform,
                spacingScale,
            }),
        );
    } else {
        depth++;
        try {
            const fileEntity = fileEntityResult.value;

            fileEntityRenderers.renderPreviewByType[fileEntity.type](get, html, {
                fileEntity,
                layout,
                getContext,
                clientInfo,
                spaceId,
                accountRegistry,
                fileRegistry,
                currentAccount,
                blockWidth,
                transformScale,
                platform,
                spacingScale,
                isInitialAppRender,
                currentDate,
                fileEntityRenderers,
            });
        } finally {
            depth--;
        }
    }

    return html;
}

export function addContentFileEntityPreviewBehavior(
    getContext: () => AppContext,
    element: HTMLElement,
    {
        spaceId,
        node,
        fileEntityId,
        fileEntityResult,
        fileEntityRenderers,
        navigate,
        getReporter,
        isInert = false,
        onShiftMouseDown,
        isLongPressDisabled,
        onLongPress,
        onDrag,
    }: {
        spaceId: SpaceId;
        node: Node;
        fileEntityId: FileEntityId;
        fileEntityResult: Result<FileEntityModel> | undefined;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        navigate: NavigateFunction;
        getReporter: () => Reporter;
        isInert?: boolean;
        onShiftMouseDown?: (event: PointerEvent) => void;
        isLongPressDisabled?: () => boolean;
        onLongPress?: () => void;
        onDrag?: (dragPromise: Promise<void>) => void;
    },
): () => void {
    const cleanupBase = addContentFilePreviewBehaviorBase(element, {
        isInert,
        onShiftMouseDown,
        isLongPressDisabled,
        onLongPress,
        onPress: () => {
            navigate(printFileEntityIdIntoPath(spaceId, fileEntityId));
        },
        onDragStart: dataTransfer => {
            const clipboardSerializer =
                ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                    node.type.schema,
                    () => spaceId,
                    () => emptyContentReferences,
                    () => {
                        throw new UnimplementedError("Shouldn’t need file attachment target");
                    },
                );

            const serializedNode = clipboardSerializer.serializeNode(node);
            assert(serializedNode instanceof HTMLElement);

            // See https://github.com/ProseMirror/prosemirror/issues/1156
            dataTransfer.effectAllowed = onDrag ? "copyMove" : "copy";

            dataTransfer.clearData();
            dataTransfer.setData("text/html", serializedNode.outerHTML);

            // We check for this content type in the `dragenter` event to know if we need
            // to show file drop targets. If this is set then it's assumed `text/html` will
            // be parsed to `fileRow` or `file` nodes.
            dataTransfer.setData("application/x.alpine.file", "");

            if (onDrag) {
                const dragPromiseResolver = createPromiseResolver();

                const handleDragEnd = () => {
                    element.removeEventListener("dragend", handleDragEnd);
                    dragPromiseResolver.resolve();
                };

                // Attach `dragend` handler here since even if this content file's behavior is
                // cleaned up (say `reference` changes) we don't want to remove our `dragend`
                // event listener.
                element.addEventListener("dragend", handleDragEnd);

                onDrag(dragPromiseResolver.promise);
            }
        },
    });

    const handleContextMenu = (event: MouseEvent) => {
        if (!navigator.clipboard) return;

        const entityNoun = getFileEntityNoun(parseFileEntityId(fileEntityId).type);

        addContextMenuActions(event, [
            [
                {
                    // We intentionally don't include the link icon here because it can look weird
                    // when you right click in a message and there's "Copy document link" and the
                    // message "Copy link". This is also why we include the entity noun. To further
                    // differentiate the text in this case.
                    //
                    // Not including the icon is also consistent with the regular file right click
                    // actions.
                    label: `Copy ${entityNoun} link`,
                    pressErrorTitle: `Couldn’t copy ${entityNoun} link`,
                    onPress: async () => {
                        const url = new URL(
                            printFileEntityIdIntoPath(spaceId, fileEntityId),
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
        ]);
    };

    element.addEventListener("contextmenu", handleContextMenu);

    let cleanupExtra: (() => void) | undefined;
    if (fileEntityResult?.ok && fileEntityRenderers) {
        const fileEntity = fileEntityResult.value;

        cleanupExtra = fileEntityRenderers.addPreviewBehaviorByType[fileEntity.type]?.(
            getContext,
            element,
            {
                fileEntity,
                spaceId,
                getReporter,
                isInert,
            },
        );
    }

    return () => {
        cleanupBase();
        element.removeEventListener("contextmenu", handleContextMenu);
        cleanupExtra?.();
    };
}
