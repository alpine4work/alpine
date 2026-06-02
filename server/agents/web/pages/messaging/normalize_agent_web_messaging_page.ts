import {Draft, produce} from "immer";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {AgentWebMessagingPage} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {ApiContentNormalizer} from "~/shared/api/markdown/normalize_api_content.js";

export function normalizeAgentWebMessagingPage<Page extends AgentWebMessagingPage<any>>(
    page: Page,
    {
        normalizePreamble,
    }: {
        normalizePreamble: (
            normalizer: ApiContentNormalizer,
            preamble: Draft<Page["preamble"]>,
        ) => void;
    },
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizePreamble(normalizer, page.preamble);

            if (page.pagination) {
                if (page.pagination.pageLink.type === "TaskMessageList") {
                    normalizer.normalizeTarget(page.pagination.pageLink.task);
                } else {
                    normalizer.normalizeTarget(page.pagination.pageLink);
                }
            }

            for (const block of page.blocks) {
                if (block.type !== "Message") continue;

                // The order of these normalization calls matters and needs to match the order of
                // `createAgentWebPageStoredLinkPathname()` calls in
                // `printAgentWebMessagingPage()`.

                normalizer.normalizeTarget(block.author);

                if (block.parent) {
                    normalizer.normalizeTarget(block.parent.author);
                    normalizer.normalize(block.parent.previewContent);
                }

                normalizer.normalize(block.content);
            }
        });
    });
}
