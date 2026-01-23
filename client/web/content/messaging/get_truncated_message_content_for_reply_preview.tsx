import {Fragment, ReactNode} from "react";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {printContentSingleLineTextSnippetPreservingMarksForClient} from "~/client/web/content/print_content_single_line_text_snippet_for_client.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {
    ContentWithReferences,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {cutContent} from "~/shared/content/cut_content.js";
import {truncateContentForMessageReplyPreview} from "~/shared/content/truncate_content_for_message_reply_preview.js";
import {codeClassName, strikeClassName} from "~/shared/design/core/constant_class_names.js";
import {assertPostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {getTruncatedParentMessagesRangeContentWithReferences} from "~/shared/messaging/get_truncated_parent_message_range_content_with_references.js";
import {mapMessagePosFromContentVersion} from "~/shared/messaging/map_message_pos_from_content_version.js";
import {createSimpleMessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {Store} from "~/shared/store/store.js";

function getTruncatedMessageContentForReplyPreviewBase(
    get: <Value>(store: Store<Value>) => Value,
    {
        content,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        content: ContentWithReferences;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): ReactNode {
    const segments = printContentSingleLineTextSnippetPreservingMarksForClient(
        get,
        {
            doc: truncateContentForMessageReplyPreview(content.doc),
            references: content.references,
        },
        {
            shouldPreserveMark: mark => mark.type.name === "code" || mark.type.name === "strike",
            accountRegistry,
            searchEntityRegistry,
            fileRegistry,
        },
    );

    return segments.map((segment, i) => {
        let node: ReactNode = segment.text;

        for (const mark of segment.marks) {
            switch (mark.type.name) {
                case "code": {
                    node = <code className={codeClassName}>{node}</code>;
                    break;
                }
                case "strike": {
                    node = <del className={strikeClassName}>{node}</del>;
                    break;
                }
            }
        }

        return <Fragment key={i}>{node}</Fragment>;
    });
}

/**
 * Get the content to render in a reply preview of a message. A content payload
 * will be truncated to enough content to fill a single line. A deleted payload
 * will show a placeholder informing the user the message is deleted.
 */
export function getTruncatedMessageContentForReplyPreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        message,
        messageNoun,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        message: MessageModel;
        messageNoun: string;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): ReactNode {
    switch (message.payload.type) {
        case "Content": {
            return getTruncatedMessageContentForReplyPreviewBase(get, {
                content: {
                    doc: cutMessageContentPayload({
                        payload: message.payload,
                        stream: message.stream,
                    }),
                    references: message.payload.content.references,
                },
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
            });
        }
        case "Deleted": {
            return getTruncatedMessageContentForReplyPreviewBase(get, {
                content: {
                    doc: createSimpleMessageContent(`Deleted ${messageNoun}`),
                    references: emptyContentReferences,
                },
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
            });
        }
        default:
            throw exhaustive(message.payload);
    }
}

export function getTruncatedPostContentForReplyPreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        post,
        contentVersion: fromContentVersion,
        startPos,
        endPos,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        post: PostModel;
        contentVersion: number;
        startPos: number;
        endPos: number;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): ReactNode {
    const actualStartPos = mapMessagePosFromContentVersion(post, fromContentVersion, startPos, 1);
    const actualEndPos = mapMessagePosFromContentVersion(post, fromContentVersion, endPos, -1);

    return getTruncatedMessageContentForReplyPreviewBase(get, {
        content: {
            doc: assertPostContent(
                cutContent(
                    post.content.doc,
                    clamp(0, actualStartPos, post.content.doc.content.size),
                    clamp(0, actualEndPos, post.content.doc.content.size),
                ),
            ),
            references: post.content.references,
        },
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });
}

export function getTruncatedMessagesRangeContentForReplyPreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        messages,
        startContentVersion,
        startPos,
        endContentVersion,
        endPos,
        messageNoun,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        messages: ReadonlyArray<MessageModel>;
        startContentVersion: number;
        startPos: number;
        endContentVersion: number;
        endPos: number;
        messageNoun: string;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): ReactNode {
    return getTruncatedMessageContentForReplyPreviewBase(get, {
        content: getTruncatedParentMessagesRangeContentWithReferences({
            messages,
            startContentVersion,
            startPos,
            endContentVersion,
            endPos,
            messageNoun,
        }),
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });
}
