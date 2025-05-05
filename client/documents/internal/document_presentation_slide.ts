import {Fragment, Node} from "prosemirror-model";
import {trimContentFragment} from "~/shared/content/trim_content.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";

export type DocumentPresentationSlide = {
    readonly pos: number;
    readonly heading: Node | null;
    readonly body: Fragment;
};

export function getDocumentPresentationSlides(
    content: DocumentContent,
): Array<DocumentPresentationSlide> {
    const slideFragments: Array<{pos: number; fragment: Fragment}> = [];

    let nextSlideStartPos = 0;
    let nextSlideStartBlockNodeIndex: number | null = null;
    const blockNodes = content.content.content;
    const blockNodeCount = blockNodes.length;
    let blockNodePos = 0;

    for (let blockNodeIndex = 0; blockNodeIndex < blockNodeCount; blockNodeIndex++) {
        const blockNode = blockNodes[blockNodeIndex]!;

        if (blockNode.type.name === "divider") {
            slideFragments.push({
                pos: nextSlideStartPos,
                fragment: Fragment.from(
                    blockNodes.slice(nextSlideStartBlockNodeIndex ?? 0, blockNodeIndex),
                ),
            });
            nextSlideStartPos = blockNodePos + blockNode.nodeSize;
            nextSlideStartBlockNodeIndex = blockNodeIndex + 1;
        }

        blockNodePos += blockNode.nodeSize;
    }

    slideFragments.push({
        pos: blockNodePos,
        fragment: Fragment.from(blockNodes.slice(nextSlideStartBlockNodeIndex ?? 0)),
    });

    return slideFragments.map(({pos, fragment: slideFragment}): DocumentPresentationSlide => {
        slideFragment = trimContentFragment(slideFragment);

        let heading: Node | null = null;
        let body = slideFragment;

        const firstNode = slideFragment.content[0];

        if (firstNode?.type.name === "heading" || firstNode?.type.name === "title") {
            heading = firstNode;
            body = Fragment.from(slideFragment.content.slice(1));
        }

        return {pos, heading, body};
    });
}
