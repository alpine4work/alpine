import {Node} from "prosemirror-model";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";

export function truncateContentForMessageReplyPreview(content: Node): Node {
    return getContentSnippet(content.resolve(0), 1, {
        // `printContentSingleLineTextSnippet()` collapses newlines. So also consider
        // newlines to be collapsed when generating a snippet.
        ignoreLineBreaks: true,
    });
}
