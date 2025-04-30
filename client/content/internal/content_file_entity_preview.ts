import classNames from "classnames";
import {Link as LinkIcon} from "phosphor-react";
import {Node} from "prosemirror-model";
import {createElement} from "react";
import {AccountClientStore} from "~/client/accounts/account_client_store.js";
import {ContentFileEntityRenderers} from "~/client/content/content_file_entity_renderers_context.js";
import {FileClientStore} from "~/client/content/file_client_store.js";
import {ContentEditorDomClipboardSerializer} from "~/client/content/internal/content_editor_dom_clipboard_serializer.js";
import {ContentFileLayout} from "~/client/content/internal/content_file_layout_computations.js";
import {
    addContentFilePreviewBehaviorBase,
    appendImageHtmlForSelection,
    appendSelectionBoundaryHtml,
} from "~/client/content/internal/content_file_preview.js";
import {AppContext} from "~/client/context/app_context.js";
import {addContextMenuActions} from "~/client/design/context_menu.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {NavigateFunction} from "~/client/remix/use_navigate.js";
import {contentStyles} from "~/client/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {FileEntityId, printFileEntityIdIntoPath} from "~/shared/files/file_entity_id.js";
import {FileEntityModel} from "~/shared/files/file_entity_model.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Result} from "~/shared/helpers/control/result.js";
import {HtmlElementGenerator} from "~/shared/helpers/html/html_generator.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {renderProsemirrorDomOutputSpec} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

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
        fileEntityResult,
        fileEntityRenderers,
        layout,
        spaceId,
        accountStore,
        fileStore,
        currentAccount,
        blockWidth,
        transformScale,
        platform,
        spacingScale,
        isInitialAppRender,
    }: {
        node: Node;
        fileEntityResult: Result<FileEntityModel> | undefined;
        fileEntityRenderers: ContentFileEntityRenderers | null;
        layout: ContentFileLayout;
        spaceId: SpaceId | null;
        accountStore: AccountClientStore;
        fileStore: FileClientStore;
        currentAccount: AccountModel | null;
        blockWidth: number;
        transformScale: number;
        platform: Platform;
        spacingScale: SpacingScale;
        isInitialAppRender: boolean;
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

    if (!fileEntityResult?.ok) {
        // NOCOMMIT: Render error
    } else if (!fileEntityRenderers) {
        // NOCOMMIT: Render error
    } else {
        const fileEntity = fileEntityResult.value;

        fileEntityRenderers.renderPreviewByType[fileEntity.type](get, html, {
            fileEntity,
            layout,
            spaceId,
            accountStore,
            fileStore,
            currentAccount,
            blockWidth,
            transformScale,
            platform,
            spacingScale,
            isInitialAppRender,
            fileEntityRenderers,
        });
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
        isInert,
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
                        throw new UnimplementedError("Shouldn't need file attachment target");
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

        addContextMenuActions(event, [
            [
                {
                    label: "Copy link",
                    icon: createElement(LinkIcon),
                    iconPlacement: "end",
                    pressErrorTitle: "Couldn’t copy link",
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
            },
        );
    }

    return () => {
        cleanupBase();
        element.removeEventListener("contextmenu", handleContextMenu);
        cleanupExtra?.();
    };
}
