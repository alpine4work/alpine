import {CalendarDate} from "@internationalized/date";
import classNames from "classnames";
import {Link as LinkIcon} from "phosphor-react";
import {Node} from "prosemirror-model";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {ContentFileEntityRenderers} from "~/client/web/content/content_file_entity_renderers_context.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {ContentBaseProsemirrorSchemaWithFiles} from "~/client/web/content/internal/content_base_schema_with_files.js";
import {ContentEditorDomClipboardSerializer} from "~/client/web/content/internal/content_editor_dom_clipboard_serializer.js";
import {renderContentFileErrorPreview} from "~/client/web/content/internal/content_file_error_preview.js";
import {
    addContentFilePreviewBehaviorBase,
    appendImageHtmlForSelection,
    appendSelectionBoundaryHtml,
} from "~/client/web/content/internal/content_file_preview.js";
import {handleContentLinkClick} from "~/client/web/content/internal/handle_content_link_click.js";
import {ContentFileLayout} from "~/client/web/content/state/content_file_layout_computations.js";
import {AppContext} from "~/client/web/context/app_context.js";
import {addContextMenuActions} from "~/client/web/design/context_menu.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {NavigateFunction} from "~/client/web/remix/use_navigate.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {SiteRegistry} from "~/client/web/sites/context/site_registry.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
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
 * dependency injection (we use React context for this) since the package we're in
 * (`//client/web/content`) can't depend on all other UI code across our codebase
 * (e.g. `//client/web/tasks` and `//client/web/documents`).
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
        searchEntityRegistry,
        fileRegistry,
        siteRegistry,
        currentAccount,
        blockWidth,
        transformScale,
        platform,
        spacingScale,
        routeLayout,
        isInitialAppRender,
        currentDate,
        suppressHydrationWarning,
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
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
        siteRegistry: SiteRegistry;
        currentAccount: AccountModel | null;
        blockWidth: number;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        routeLayout: RouteLayout;
        isInitialAppRender: boolean;
        currentDate: CalendarDate;
        suppressHydrationWarning: () => void;
    },
): HtmlElementGenerator {
    assert(node.type.name === "file");

    const {html} = renderProsemirrorDomOutputSpec(node.type.spec.toDOM!(node));

    assert(html instanceof HtmlElementGenerator);

    if (process.env.NODE_ENV !== "production") {
        html.setAttribute(
            "data-testid",
            `ContentFileEntityPreview:${fileEntityId.split(":", 2)[0]!}`,
        );
    }

    html.setAttribute(
        "class",
        classNames(html.getAttribute("class"), contentStyles.fileEntityClassName),
    );

    appendSelectionBoundaryHtml(html);
    appendImageHtmlForSelection(html, platform);

    if (depth >= fileEntityMaxRecursionDepth && !fileEntityResult) {
        // If we've hit the max depth where the backend stops loading file entities to
        // prevent infinite recursion then instead of rendering an error message, render
        // nothing.
    } else if (!fileEntityRenderers || !fileEntityResult?.ok) {
        const fileEntityIdObject = parseFileEntityId(fileEntityId);
        const entityNoun = getFileEntityNoun(fileEntityIdObject.type);

        const error =
            fileEntityResult?.error ??
            getOrSetDefaultMapValue((fallbackErrorByNode ??= new WeakMap()), node, () =>
                !fileEntityRenderers
                    ? new InternalError("File entity renderers weren\u2019t provided")
                    : new NotFoundError("File entity not found in content references"),
            );

        if (!reportedErrors?.has(error)) {
            (reportedErrors ??= new WeakSet()).add(error);
            getContext().react.reportRenderedError(error);
        }

        // Example: Deleted task collections return `ErrorCode.NotFound`.
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
                    ? `Couldn\u2019t find ${entityNoun}`
                    : isPermissionDeniedError
                      ? `Private ${entityNoun}`
                      : `Couldn\u2019t preview ${entityNoun}`,
                displayMessage:
                    error instanceof ErrorBase
                        ? (error.displayMessage ?? defaultErrorDisplayMessage)
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
                searchEntityRegistry,
                fileRegistry,
                siteRegistry,
                currentAccount,
                blockWidth,
                transformScale,
                platform,
                spacingScale,
                routeLayout,
                isInitialAppRender,
                currentDate,
                fileEntityRenderers,
                suppressHydrationWarning,
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
        onPress: event => {
            handleContentLinkClick(
                event,
                printFileEntityIdIntoPath(spaceId, fileEntityId),
                navigate,
            );
        },
        onDragStart: dataTransfer => {
            const schema = ContentBaseProsemirrorSchemaWithFiles.get();

            const clipboardSerializer =
                ContentEditorDomClipboardSerializer.fromSchemaWithContentReferences(
                    schema,
                    () => spaceId,
                    () => emptyContentReferences,
                    () => {
                        throw new UnimplementedError("Shouldn\u2019t need file attachment target");
                    },
                );

            const node = schema.node("file", {fileId: fileEntityId});

            const serializedNode = clipboardSerializer.serializeNode(node);
            assert(serializedNode instanceof HTMLElement);

            // See https://github.com/ProseMirror/prosemirror/issues/1156
            dataTransfer.effectAllowed = onDrag ? "copyMove" : "copy";

            dataTransfer.clearData();
            dataTransfer.setData("text/html", serializedNode.outerHTML);

            // We check for this content type in the `dragenter` event to know if we need to
            // show file drop targets. If this is set then it's assumed `text/html` will be
            // parsed to `fileRow` or `file` nodes.
            dataTransfer.setData("application/x.alpine.file", "");

            if (onDrag) {
                const dragPromiseResolver = createPromiseResolver();

                const handleDragEnd = () => {
                    element.removeEventListener("dragend", handleDragEnd);
                    dragPromiseResolver.resolve();
                };

                // Attach `dragend` handler here since even if this content file's behavior is
                // cleaned up (say `reference` changes) we don't want to remove our `dragend` event
                // listener.
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
                    label: `Copy ${entityNoun} link`,
                    pressErrorTitle: `Couldn\u2019t copy ${entityNoun} link`,
                    icon: <LinkIcon />,
                    iconPlacement: "end",
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
                fileEntityRenderers,
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
