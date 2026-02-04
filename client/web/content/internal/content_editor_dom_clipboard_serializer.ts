import {DOMOutputSpec, DOMSerializer, Fragment, Mark, Node, Schema} from "prosemirror-model";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {renderContentMentionToTextForClient} from "~/client/web/content/render_content_mention_to_text_for_client.js";
import {layoutContentFileParent} from "~/client/web/content/state/content_file_layout.js";
import {isHtmlElementBlockLevel} from "~/client/web/helpers/elements/is_node_block_level.js";
import {getSearchDynamicEntityPath} from "~/client/web/search/core/get_search_entity_path.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {clampListItemIndentation} from "~/shared/content/content_schema.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {
    isFileWebSafeAudioContentType,
    isFileWebSafeImageContentType,
} from "~/shared/files/file_content_type.js";
import {FileEntityId, printFileEntityIdIntoPath} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {parseSearchDynamicEntityId} from "~/shared/search/search_entity_id.js";

// Augment with types for some internal methods from:
// https://github.com/ProseMirror/prosemirror-model/blob/26c634ffff8ad6544fda12ed70c99f12a65959f3/src/to_dom.ts#L27
declare module "prosemirror-model" {
    interface DOMSerializer {
        serializeNodeInner(node: Node, options: {document?: Document}): globalThis.Node;
        serializeMark(
            mark: Mark,
            inline: boolean,
            options: {document?: Document},
        ):
            | {
                  dom: globalThis.Node;
                  contentDOM?: HTMLElement;
              }
            | undefined;
    }
}

/**
 * `DOMSerializer` but with better support for serializing nested lists
 * to HTML.
 */
export class ContentEditorDomClipboardSerializer extends DOMSerializer {
    static fromSchemaWithContentReferences(
        schema: Schema,
        getSpaceId: () => SpaceId,
        getContentReferences: () => ContentReferences,
        getFileAttachmentTarget: () => FileAttachmentTarget | "Uploader",
    ): ContentEditorDomClipboardSerializer {
        return new ContentEditorDomClipboardSerializer(
            this.nodesFromSchema(schema),
            this.marksFromSchema(schema),
            getSpaceId,
            getContentReferences,
            getFileAttachmentTarget,
        );
    }

    private readonly _getSpaceId: () => SpaceId;
    private readonly _getContentReferences: () => ContentReferences;
    private readonly _getFileAttachmentTarget: () => FileAttachmentTarget | "Uploader";

    protected constructor(
        nodes: {[node: string]: (node: Node) => DOMOutputSpec},
        marks: {[mark: string]: (mark: Mark, inline: boolean) => DOMOutputSpec},
        getSpaceId: () => SpaceId,
        getContentReferences: () => ContentReferences,
        getFileAttachmentTarget: () => FileAttachmentTarget | "Uploader",
    ) {
        super(nodes, marks);
        this._getSpaceId = getSpaceId;
        this._getContentReferences = getContentReferences;
        this._getFileAttachmentTarget = getFileAttachmentTarget;
    }

    override serializeNodeInner(node: Node, options: {document?: Document}): globalThis.Node {
        const document = options.document ?? window.document;

        const resourceServiceUrl = __RESOURCE_SERVICE_URL__
            ? __RESOURCE_SERVICE_URL__
            : window.location.origin;

        if (node.type.name === "unorderedListItem")
            return this._serializeListItemNode("ul", node, options);
        if (node.type.name === "orderedListItem")
            return this._serializeListItemNode("ol", node, options);

        if (node.type.name === "checkListItem") {
            const checkboxDom = document.createElement("input");

            checkboxDom.setAttribute("type", "checkbox");
            checkboxDom.setAttribute("disabled", "");
            if (node.attrs.checked) checkboxDom.setAttribute("checked", "");

            return this._serializeListItemNode("ul", node, {
                ...options,
                prependContentDom: checkboxDom,
            });
        }

        if (node.type.name === "mention") {
            const mention: ContentMention = node.attrs.mention;
            const spaceId = this._getSpaceId();

            const mentionText = renderContentMentionToTextForClient(
                store => store.getSnapshot(),
                node.attrs.mention,
                this._getContentReferences(),
                {
                    accountRegistry: getAccountRegistry(spaceId),
                    searchEntityRegistry: getSearchEntityRegistry(spaceId),
                    fileRegistry: getFileRegistry(spaceId),
                },
            );

            switch (mention.type) {
                case "Account": {
                    const dom = document.createElement("span");

                    dom.setAttribute("data-cy-mention", mention.accountId);
                    if (mention.isShort) dom.setAttribute("data-cy-mention-short", "");

                    dom.textContent = mentionText;
                    return dom;
                }

                // Serialize mention search entities as `<a>` tags. So when pasted in another
                // app they link back to the mentioned content in Alpine.
                case "SearchEntity": {
                    const dom = document.createElement("a");

                    dom.setAttribute(
                        "href",
                        new URL(
                            getSearchDynamicEntityPath(
                                spaceId,
                                parseSearchDynamicEntityId(mention.entityId),
                                "wide",
                            ),
                            window.location.href,
                        ).toString(),
                    );

                    dom.setAttribute("data-cy-mention", "");

                    dom.textContent = mentionText;
                    return dom;
                }

                default:
                    throw exhaustive(mention);
            }
        }

        if (node.type.name === "codeBlock") {
            const preDom = document.createElement("pre");
            const codeDom = document.createElement("code");

            if (node.attrs.language && node.attrs.language !== "text") {
                codeDom.setAttribute("data-cy-language", node.attrs.language);
            }

            let isFirstChild = true;

            node.forEach(childNode => {
                assert(childNode.type.name === "codeBlockLine");

                if (isFirstChild) {
                    isFirstChild = false;
                } else {
                    codeDom.appendChild(document.createTextNode("\n"));
                }

                // Serialize each `codeBlockLine` directly into our `<code>` element. We don't
                // want to call `serializeNodeInner()` for `codeBlockLine` since that'll create
                // a DOM element for each line which we don't want to put on the clipboard.
                this.serializeFragment(childNode.content, options, codeDom);
            });

            preDom.appendChild(codeDom);
            return preDom;
        }

        // If we're serializing content within a single `codeBlockLine` then serialize
        // to a `<code>` element. So when pasted the text gets code styles. This
        // happens when you copy some text in a single line of a code block.
        //
        // This branch is not executed when serializing a `codeBlock`. Instead we
        // serialize `codeBlockLine` children directly in the `codeBlock` serializer.
        if (node.type.name === "codeBlockLine") {
            const codeDom = document.createElement("code");

            this.serializeFragment(node.content, options, codeDom);

            return codeDom;
        }

        // We serialize our file parents with very lightweight CSS for rendering files
        // the same way they might look in a document. That way compatible applications
        // can parse the clipboard properly. Also, we use these lightweight styles
        // within Alpine ourselves to parse content back from generated HTML.
        if (
            node.type.name === "fileRow" ||
            node.type.name === "fileFloat" ||
            node.type.name === "fileRowTable"
        ) {
            const fileRowDom = document.createElement("div");

            const fileRegistry = getFileRegistry(this._getSpaceId());
            const contentReferences = this._getContentReferences();

            const platform: Platform = "desktop";
            const spacingScale: SpacingScale = "small";

            const layouts = layoutContentFileParent(node, {
                blockWidth:
                    contentStyles.blockMaxWidthRem[platform] * remPxBySpacingScale[spacingScale],
                platform,
                spacingScale,
                getFile: fileId => {
                    const fileReference = contentReferences.fileById?.get(fileId);
                    if (!fileReference) return null;
                    return fileRegistry.getFileStore(fileReference).getSnapshot();
                },
            });

            const gap = contentStyles.fileRowGapWidthRem * remPxBySpacingScale.small;

            if (node.type.groups.includes("fileRowLike")) {
                fileRowDom.style.display = "flex";
                fileRowDom.style.gap = `${gap}px`;
                fileRowDom.style.marginTop = `${gap}px`;
                fileRowDom.style.marginBottom = `${gap}px`;
            } else if (node.type.name === "fileFloat") {
                fileRowDom.style.float = node.attrs.direction;
                fileRowDom.style.clear = "both";

                // Intentionally only `marginBottom`. That way the file is flush with the top
                // of whatever block it's next to but there's a bit of space between the file
                // and text that flows below.
                fileRowDom.style.marginBottom = `${gap}px`;

                if (node.attrs.direction === "left") {
                    fileRowDom.style.marginRight = `${gap}px`;
                } else {
                    fileRowDom.style.marginLeft = `${gap}px`;
                }
            }

            this.serializeFragment(node.content, options, fileRowDom);

            // Iterate through our children and set our layout dimensions on each one. That
            // way the clipboard HTML will end up rendering a gallery that looks close to
            // what's in Alpine.
            let index = 0;
            let fileRowChildDom = fileRowDom.firstElementChild;
            while (fileRowChildDom) {
                const layout = layouts[index];
                if (layout && fileRowChildDom instanceof HTMLElement) {
                    if (!isHtmlElementBlockLevel(fileRowChildDom)) {
                        fileRowChildDom.style.display = "block";
                    }
                    if (
                        fileRowChildDom instanceof HTMLImageElement ||
                        fileRowChildDom instanceof HTMLVideoElement ||
                        fileRowChildDom instanceof HTMLObjectElement ||
                        fileRowChildDom instanceof HTMLIFrameElement
                    ) {
                        fileRowChildDom.width = Math.round(layout.width);
                        fileRowChildDom.height = Math.round(layout.height);
                    } else {
                        fileRowChildDom.style.width = `${Math.round(layout.width)}px`;
                        fileRowChildDom.style.height = `${Math.round(layout.height)}px`;
                    }
                }

                index++;
                fileRowChildDom = fileRowChildDom.nextElementSibling;
            }

            return fileRowDom;
        }

        if (node.type.name === "file") {
            const fileId: FileId | FileEntityId | null = node.attrs.fileId;

            // We represent file entities as an `<iframe>`. This way pastes in an app that
            // supports `<iframe>`s will render the document/channel/whatever.
            if (fileId && !isId<FileId>(fileId)) {
                const fileDom = document.createElement("iframe");

                fileDom.setAttribute(
                    "src",
                    new URL(
                        printFileEntityIdIntoPath(this._getSpaceId(), fileId),
                        // NOTE(calebmer): This must be `window.location.origin` not
                        // `resourceServiceUrl`. Since the URL is something like
                        // `/s/:spaceId/documents/:documentId`. It's a URL into our app since we're
                        // dealing with a file entity here.
                        window.location.origin,
                    ).toString(),
                );

                return fileDom;
            }

            const fileReference = fileId
                ? this._getContentReferences().fileById?.get(fileId)
                : undefined;

            // If the file is a web safe image then let's use an `<img>` element in our
            // generated HTML. If an application is able to process pasted HTML it should
            // be able to interpret our `<img>` element correctly.
            //
            // We use the file itself as the `<img>`'s `src` instead of a processed preview
            // file or resized file.
            if (fileReference && isFileWebSafeImageContentType(fileReference.file.contentType)) {
                const fileDom = document.createElement("img");

                fileDom.setAttribute(
                    "src",
                    new URL(
                        `/files/${this._getSpaceId()}/${fileId}${fileReference.signedUrlSearch}`,
                        resourceServiceUrl,
                    ).toString(),
                );

                // Needed to get a proper CORS response from the resource service where our
                // files are hosted.
                fileDom.setAttribute("crossorigin", "anonymous");

                const fileAttachmentTarget = this._getFileAttachmentTarget();
                if (fileAttachmentTarget === "Uploader") {
                    fileDom.setAttribute("data-cy-attached", "uploader");
                } else {
                    fileDom.setAttribute(
                        "data-cy-attached",
                        serializeFileAttachmentTargetString(fileAttachmentTarget),
                    );
                }

                return fileDom;
            }

            // If the file is web safe video then let's use a `<video>` element in our
            // generated HTML. `video/webm` has broad compatibility across browsers. Some
            // `video/mp4` codecs have broad compatibility across browsers and others
            // don't. We treat `video/mp4` as web safe video because it's a common format
            // for sharing video on the web even if it's not 100% web safe.
            //
            // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video
            else if (
                fileReference &&
                (fileReference.file.contentType === "video/webm" ||
                    fileReference.file.contentType === "video/mp4")
            ) {
                const fileDom = document.createElement("video");

                fileDom.setAttribute("controls", "");

                const fileSourceDom = document.createElement("source");
                fileDom.appendChild(fileSourceDom);

                fileSourceDom.setAttribute(
                    "src",
                    new URL(
                        `/files/${this._getSpaceId()}/${fileId}${fileReference.signedUrlSearch}`,
                        resourceServiceUrl,
                    ).toString(),
                );

                const fileAttachmentTarget = this._getFileAttachmentTarget();
                if (fileAttachmentTarget === "Uploader") {
                    fileDom.setAttribute("data-cy-attached", "uploader");
                } else {
                    fileDom.setAttribute(
                        "data-cy-attached",
                        serializeFileAttachmentTargetString(fileAttachmentTarget),
                    );
                }

                return fileDom;
            }

            // If the file is web safe audio then let's use an `<audio>` element in our
            // generated HTML. Some `audio/mp4` codecs have broad compatibility across
            // browsers and others don't. We treat `audio/mp4` as web safe audio because
            // it's a common format for sharing audio on the web even if it's not 100% web
            // safe.
            //
            // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/audio
            else if (
                fileReference &&
                (isFileWebSafeAudioContentType(fileReference.file.contentType) ||
                    fileReference.file.contentType === "audio/mp4")
            ) {
                const fileDom = document.createElement("audio");

                fileDom.setAttribute("controls", "");

                fileDom.setAttribute(
                    "src",
                    new URL(
                        `/files/${this._getSpaceId()}/${fileId}${fileReference.signedUrlSearch}`,
                        resourceServiceUrl,
                    ).toString(),
                );

                const fileAttachmentTarget = this._getFileAttachmentTarget();
                if (fileAttachmentTarget === "Uploader") {
                    fileDom.setAttribute("data-cy-attached", "uploader");
                } else {
                    fileDom.setAttribute(
                        "data-cy-attached",
                        serializeFileAttachmentTargetString(fileAttachmentTarget),
                    );
                }

                return fileDom;
            }

            // Otherwise, fallback to an `<object>` element. `<object>` elements are the
            // way you get the browser to use its native PDF renderer.
            //
            // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/object
            else {
                const fileDom = document.createElement("object");

                if (fileId) {
                    if (fileReference) {
                        fileDom.setAttribute("type", fileReference.file.contentType);
                    }

                    fileDom.setAttribute(
                        "data",
                        new URL(
                            `/files/${this._getSpaceId()}/${fileId}${
                                fileReference ? fileReference.signedUrlSearch : ""
                            }`,
                            resourceServiceUrl,
                        ).toString(),
                    );

                    const fileAttachmentTarget = this._getFileAttachmentTarget();
                    if (fileAttachmentTarget === "Uploader") {
                        fileDom.setAttribute("data-cy-attached", "uploader");
                    } else {
                        fileDom.setAttribute(
                            "data-cy-attached",
                            serializeFileAttachmentTargetString(fileAttachmentTarget),
                        );
                    }
                }

                return fileDom;
            }
        }

        if (node.type.name === "table") {
            const tableDom = document.createElement("table");
            const tableMap = ContentTableMap.get(node);

            // Add the data attributes with JSON stringified values
            tableDom.setAttribute("data-cy-width", JSON.stringify(tableMap.tableWidth));
            tableDom.setAttribute(
                "data-cy-column-widths",
                tableMap.columnWidths.map(columnWidth => JSON.stringify(columnWidth)).join(", "),
            );
            if (node.attrs.hasHeaderRow) tableDom.setAttribute("data-cy-header-row", "");
            if (node.attrs.hasHeaderColumn) tableDom.setAttribute("data-cy-header-column", "");

            // Create tbody element
            const tbody = document.createElement("tbody");
            tableDom.appendChild(tbody);

            // Serialize table content directly into tbody
            this.serializeFragment(node.content, options, tbody);

            return tableDom;
        }

        const dom = super.serializeNodeInner(node, options);

        // Remove any custom styling for this element. Let the user agent styles for
        // wherever we're pasting apply.
        if (dom instanceof HTMLElement) {
            dom.removeAttribute("class");
            dom.removeAttribute("style");
        }

        return dom;
    }

    override serializeMark(mark: Mark, inline: boolean, options: {document?: Document}) {
        const result = super.serializeMark(mark, inline, options);

        // Remove any custom styling for this element. Let the user agent styles for
        // wherever we're pasting apply.
        if (result && result.dom instanceof HTMLElement) {
            result.dom.removeAttribute("class");
            result.dom.removeAttribute("style");
        }

        return result;
    }

    /**
     * When serializing a list item node, created nested `<ul>` and `<ol>` elements
     * to the list item's level of indentation.
     */
    private _serializeListItemNode(
        listTagName: "ul" | "ol",
        node: Node,
        options: {document?: Document; prependContentDom?: globalThis.Node},
    ): globalThis.Node {
        const document = options?.document ?? window.document;

        const indent = clampListItemIndentation(node.attrs.indent);

        const rootListDom = document.createElement(listTagName);
        let listDom = rootListDom;

        for (let i = 0; i < indent; i++) {
            const nestedListDom = document.createElement(listTagName);
            listDom.appendChild(nestedListDom);
            listDom = nestedListDom;
        }

        const listItemDom = document.createElement("li");

        if (typeof node.attrs.orderStart === "number") {
            listItemDom.setAttribute("value", String(node.attrs.orderStart));
        }

        listDom.appendChild(listItemDom);

        if (options.prependContentDom) {
            listItemDom.appendChild(options.prependContentDom);
        }

        this.serializeFragment(node.content, options, listItemDom);

        return rootListDom;
    }

    override serializeFragment(
        fragment: Fragment,
        options: {document?: Document} = {},
        target?: HTMLElement | DocumentFragment,
    ): HTMLElement | DocumentFragment {
        const dom = super.serializeFragment(fragment, options, target);

        this._flattenSerializedFragment(dom);

        return dom;
    }

    /**
     * Merge all adjacent `<ul>` and `<ol>` elements to create semantic list HTML.
     * Nested lists will not be nested under `<li>`s which is not, technically,
     * semantic but browsers and copy/paste systems commonly support it.
     */
    private _flattenSerializedFragment(dom: HTMLElement | DocumentFragment) {
        const flattenChildDoms = new Set<HTMLElement>();

        let childDom = dom.firstChild;
        while (childDom) {
            if (
                childDom instanceof HTMLElement &&
                (childDom.tagName === "UL" || childDom.tagName === "OL") &&
                childDom.nextSibling instanceof HTMLElement &&
                (childDom.nextSibling.tagName === "UL" || childDom.nextSibling.tagName === "OL") &&
                // We can merge if the list type is the same or if there are not any direct
                // `<li>` children. If there's a direct `<li>` child then we need to
                // preserve the list type.
                (childDom.nextSibling.tagName === childDom.tagName ||
                    iterableEvery(
                        childDom.nextSibling.childNodes,
                        cousinDom =>
                            !(cousinDom instanceof HTMLElement) || cousinDom.tagName !== "LI",
                    ))
            ) {
                for (const cousinDom of childDom.nextSibling.childNodes) {
                    childDom.appendChild(cousinDom);
                }
                dom.removeChild(childDom.nextSibling);
                flattenChildDoms.add(childDom);
            } else {
                childDom = childDom.nextSibling;
            }
        }

        for (const childDom of flattenChildDoms) {
            this._flattenSerializedFragment(childDom);
        }
    }
}
