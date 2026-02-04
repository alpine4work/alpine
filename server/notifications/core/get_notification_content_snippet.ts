import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {MessageContent, assertMessageContent} from "~/shared/content/message_content_schema.js";
import {PostContent, assertPostContent} from "~/shared/forum/post_content_schema.js";

/**
 * Get the content snippet for `MessageContent` for a notification event.
 */
export function getNotificationMessageContentSnippet(content: MessageContent): MessageContent {
    return assertMessageContent(
        getContentSnippet(content.resolve(0), 1, {
            // This snippet will be printed with `printContentSingleLineTextSnippet()`
            // which collapses newlines. So also consider newlines to be collapsed when
            // generating a snippet.
            ignoreLineBreaks: true,
        }),
    );
}

/**
 * Get the content snippet for `PostContent` for a notification event.
 */
export function getNotificationPostContentSnippet(content: PostContent): PostContent {
    return assertPostContent(
        getContentSnippet(content.resolve(0), 1, {
            // This snippet will be printed with `printContentSingleLineTextSnippet()`
            // which collapses newlines. So also consider newlines to be collapsed when
            // generating a snippet.
            ignoreLineBreaks: true,
        }),
    );
}
