import {DocumentationImageData} from "~/shared/docs/documentation_image_data.js";

type DocumentationHastNode = {
    type: string;
    tagName?: string;
    properties?: Record<string, unknown>;
    children?: Array<DocumentationHastNode>;
};

/** Add generated responsive image attributes to compiled MDX image elements. */
export function createDocumentationImageRehypePlugin({
    imageDataBySource,
    sizes,
}: {
    imageDataBySource: Record<string, DocumentationImageData>;
    sizes: string;
}) {
    return () => (tree: DocumentationHastNode) => {
        visit(tree);
    };

    /** Walk compiled HAST and attach responsive metadata to known images. */
    function visit(node: DocumentationHastNode) {
        if (node.tagName === "img" && node.properties !== undefined) {
            const source = node.properties.src;
            const image = typeof source === "string" ? imageDataBySource[source] : undefined;
            // External and unsupported images are intentionally left untouched; only sources
            // from the build manifest have safe generated variants.
            if (image !== undefined) {
                node.properties = {
                    ...node.properties,
                    src: image.src,
                    srcSet: image.srcSet,
                    sizes,
                    width: image.width,
                    height: image.height,
                    loading: "lazy",
                    decoding: "async",
                };
            }
        }

        for (const child of node.children ?? []) visit(child);
    }
}
