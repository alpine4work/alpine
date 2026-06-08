import {Draft, produce} from "immer";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageCustomBlockBase,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {ApiContentNormalizer} from "~/shared/api/markdown/normalize_api_content.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function normalizeAgentWebMessagingPage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
    Page extends AgentWebMessagingPage<Preamble, CustomBlock>,
>(
    page: Page,
    {
        normalizePreamble,
        normalizeCustomBlock,
    }: {
        normalizePreamble: (
            normalizer: ApiContentNormalizer,
            preamble: Draft<Page["preamble"]>,
        ) => void;
        normalizeCustomBlock: (
            normalizer: ApiContentNormalizer,
            customBlock: Draft<CustomBlock>,
        ) => void;
    },
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizePreamble(normalizer, page.preamble);

            if (page.pagination) {
                if (page.pagination.pageLink.type === "TaskMessageList") {
                    normalizer.normalizeReference(page.pagination.pageLink.task);
                } else {
                    normalizer.normalizeReference(page.pagination.pageLink);
                }
            }

            for (const block of page.blocks) {
                switch (block.type) {
                    case "Time": {
                        break;
                    }
                    case "Message": {
                        // The order of these normalization calls matters and needs to match the order of
                        // `createAgentWebPageStoredLinkPathname()` calls in
                        // `printAgentWebMessagingPage()`.

                        normalizer.normalizeReference(block.author);

                        if (block.parent) {
                            normalizer.normalizeReference(block.parent.author);
                            normalizer.normalize(block.parent.previewContent);
                        }

                        normalizer.normalize(block.content);
                        break;
                    }
                    case "Custom": {
                        normalizeCustomBlock(normalizer, block);
                        break;
                    }
                    default:
                        throw exhaustive(block);
                }
            }
        });
    });
}
