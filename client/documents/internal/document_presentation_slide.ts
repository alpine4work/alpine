import {Fragment, Node} from "prosemirror-model";
import {trimContentFragment} from "~/client/content/trim_content.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";

export type DocumentPresentationSlide = {
    readonly heading: Node | null;
    readonly body: Fragment;
};

export function getDocumentPresentationSlides(
    content: DocumentContent,
): Array<DocumentPresentationSlide> {
    const slideFragments: Array<Fragment> = [];

    let nextSlideStartBlockNodeIndex: number | null = null;
    const blockNodes = content.content.content;
    const blockNodeCount = blockNodes.length;

    for (let blockNodeIndex = 0; blockNodeIndex < blockNodeCount; blockNodeIndex++) {
        const blockNode = blockNodes[blockNodeIndex]!;

        if (blockNode.type.name === "divider") {
            slideFragments.push(
                Fragment.from(blockNodes.slice(nextSlideStartBlockNodeIndex ?? 0, blockNodeIndex)),
            );
            nextSlideStartBlockNodeIndex = blockNodeIndex + 1;
        }
    }

    slideFragments.push(Fragment.from(blockNodes.slice(nextSlideStartBlockNodeIndex ?? 0)));

    return slideFragments.map((slideFragment): DocumentPresentationSlide => {
        slideFragment = trimContentFragment(slideFragment);

        let heading: Node | null = null;
        let body = slideFragment;

        const firstNode = slideFragment.content[0];

        if (firstNode?.type.name === "heading" || firstNode?.type.name === "title") {
            heading = firstNode;
            body = Fragment.from(slideFragment.content.slice(1));
        }

        return {heading, body};
    });
}
