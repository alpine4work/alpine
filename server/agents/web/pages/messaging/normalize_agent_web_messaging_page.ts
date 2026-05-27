import {produce} from "immer";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {AgentWebMessagingPage} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";

export function normalizeAgentWebMessagingPage<Page extends AgentWebMessagingPage>(
    page: Page,
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizer.normalizeInlineElements(page.preamble.elements);

            if (page.preamble.pagination)
                normalizer.normalizeTarget(page.preamble.pagination.target);

            for (const block of page.blocks) {
                if (block.type !== "Message") continue;

                // The order of these normalization calls matters and needs to match the order of
                // `createAgentWebPageLinkPathname()` calls in `printAgentWebMessagingPage()`.

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
