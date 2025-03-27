import {Node} from "prosemirror-model";
import {
    ContentFileLayout,
    computeContentFileFloatLayout,
    computeContentFileRowLayout,
    computeContentFileRowTableLayout,
} from "~/client/content/internal/content_file_layout_computations.js";
import {createCachedFunction} from "~/client/content/internal/helpers/create_cached_function.js";
import {Platform} from "~/shared/design/core/platform.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {InternalError} from "~/shared/error/error.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId} from "~/shared/id/types/id_types.js";

const actuallyLayoutContentFileParent = createCachedFunction(
    (
        node: Node,
        screenWidth: number,
        platform: Platform,
        spacingScale: SpacingScale,
        withoutBlockMaxWidth: boolean,
        getFile: (fileId: FileId) => FileModelData | null,
        ...files: Array<FileModelData | null>
    ) => {
        switch (node.type.name) {
            case "fileRow": {
                return computeContentFileRowLayout(files, {
                    screenWidth,
                    platform,
                    spacingScale,
                    withoutBlockMaxWidth,
                });
            }
            case "fileFloat": {
                assert(files.length === 1);
                assert(files[0] !== undefined);
                return [
                    computeContentFileFloatLayout(node.attrs.direction, files[0], {
                        screenWidth,
                        platform,
                        spacingScale,
                        withoutBlockMaxWidth,
                    }),
                ];
            }
            case "fileRowTable": {
                // NOTE(rohit): In `content_schema_extra.tsx` where `fileRowTable` node
                // is defined, we already made sure that  `content: "file{1,1}"` .
                // But for the sake of clarity we'll assert that the fileRowTable node
                // contains exactly one file node.
                assert(node.content.childCount === 1, "fileRowTable must contain exactly one file");
                const fileNode = node.content.firstChild!;
                assert(fileNode.type.name === "file", "fileRowTable child must be a file node");

                const fileId: FileId | null = fileNode.attrs.fileId;
                const file = fileId ? getFile(fileId) : null;

                return [
                    computeContentFileRowTableLayout(file, {
                        screenWidth,
                        platform,
                        spacingScale,
                        withoutBlockMaxWidth,
                    }),
                ];
            }
            default: {
                throw new InternalError(quote`Node ${node.type.name} is not a file parent node`);
            }
        }
    },
);

/**
 * Layout the files within a file parent node (e.g. a `fileRow` or
 * `fileFloat`). Every child of the file parent should be a `file` node and
 * we'll return a `ContentFileLayout` object for each child.
 *
 * This function is cached so if the node hasn't changed, file references
 * haven't changed, and configuration options haven't changed then you'll get
 * the exact same (referentially equal) value.
 */
export function layoutContentFileParent(
    node: Node,
    {
        screenWidth,
        platform,
        spacingScale,
        withoutBlockMaxWidth,
        getFile,
    }: {
        screenWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
        withoutBlockMaxWidth: boolean;
        getFile: (fileId: FileId) => FileModelData | null;
    },
): ReadonlyArray<ContentFileLayout> {
    const files = node.content.content.map(childNode => {
        if (childNode.type.name !== "file") {
            throw new InternalError(
                quote`Expected file parent node to only have "file" node children but instead found a "${childNode.type.name}" child`,
            );
        }

        const fileId: FileId | null = childNode.attrs.fileId;
        if (fileId === null) return null;
        return getFile(fileId);
    });

    return actuallyLayoutContentFileParent(
        node,
        screenWidth,
        platform,
        spacingScale,
        withoutBlockMaxWidth,
        getFile,
        ...files,
    );
}

/**
 * Layout a `file`. You must provide the position of the file since to layout a
 * file we actually need to layout the file's parent (which is done with
 * `layoutContentFileParent()`).
 *
 * This function is cached and shares the same cache as
 * `layoutContentFileParent()`. If you call this function with a child node of
 * the parent node you passed into `layoutContentFileParent()` and file
 * references plus options are the same then you'll get the exact same
 * (referentially equal) layout without needing to recompute layout.
 */
export function layoutContentFile(
    doc: Node,
    pos: number,
    node: Node,
    options: {
        screenWidth: number;
        platform: Platform;
        spacingScale: SpacingScale;
        withoutBlockMaxWidth: boolean;
        getFile: (fileId: FileId) => FileModelData | null;
    },
): ContentFileLayout {
    const $pos = doc.resolve(pos);
    assert($pos.nodeAfter && $pos.nodeAfter.eq(node));
    const layouts = layoutContentFileParent($pos.parent, options);
    return layouts[$pos.index()]!;
}
