import {Mark} from "prosemirror-model";
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
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {printContentSingleLineTextSnippetForFileRow} from "~/shared/content/print_content_single_line_text_snippet_for_file_row.js";
import {truncateContentForMessageReplyPreview} from "~/shared/content/truncate_content_for_message_reply_preview.js";
import {codeClassName, strikeClassName} from "~/shared/design/core/constant_class_names.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assertPostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
    HtmlFragmentGenerator,
    HtmlTextGenerator,
} from "~/shared/helpers/html/html_generator.js";
import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";
import {cutMessageContentPayload} from "~/shared/messaging/cut_message_content_payload.js";
import {getTruncatedParentMessagesRangeContentWithReferences} from "~/shared/messaging/get_truncated_parent_message_range_content_with_references.js";
import {mapMessagePosFromContentVersion} from "~/shared/messaging/map_message_pos_from_content_version.js";
import {MessageContentPayloadModelFile, MessageModel} from "~/shared/messaging/message_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * Generate a text preview for an array of files, using the format "Image" or
 * "Image. Image 2. Image 3" for multiple adjacent files of the same type.
 *
 * We can't use `printContentSingleLineTextSnippet` directly because message
 * payload files are not a ProseMirror node.
 */
function getTruncatedMessageContentForReplyPreviewWithOnlyFiles(
    files: ReadonlyArray<MessageContentPayloadModelFile>,
): string {
    const fileById = new Map<FileId, MessageContentPayloadModelFile & {type: "File"}>();
    const fileIds: Array<FileId | FileEntityId | null> = [];

    for (const file of files) {
        switch (file.type) {
            case "File": {
                fileById.set(file.file.id, file);
                fileIds.push(file.file.id);
                break;
            }
            case "FileEntity": {
                fileIds.push(file.fileEntityId);
                break;
            }
            case "Null": {
                fileIds.push(file.fileId);
                break;
            }
            default:
                throw exhaustive(file);
        }
    }

    return printContentSingleLineTextSnippetForFileRow(
        fileIds,
        id => fileById.get(id)?.file ?? null,
    ).parts.join(". ");
}

function getTruncatedMessageContentForReplyPreviewSegments(
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
): ReadonlyArray<{
    text: string;
    marks: ReadonlyArray<Mark>;
}> {
    return printContentSingleLineTextSnippetPreservingMarksForClient(
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
}

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
    const segments = getTruncatedMessageContentForReplyPreviewSegments(get, {
        content,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });

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

function getTruncatedMessageContentForReplyHtmlGeneratorPreviewBase(
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
): HtmlFragmentGenerator {
    const segments = getTruncatedMessageContentForReplyPreviewSegments(get, {
        content,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });

    const fragmentHtml = new HtmlFragmentGenerator();

    for (const segment of segments) {
        let html: HtmlContainerGenerator = fragmentHtml;

        for (const mark of segment.marks) {
            switch (mark.type.name) {
                case "code": {
                    const codeHtml = html.appendChild(new HtmlElementGenerator("code"));
                    codeHtml.setAttribute("class", codeClassName);
                    html = codeHtml;
                    break;
                }
                case "strike": {
                    const strikeHtml = html.appendChild(new HtmlElementGenerator("del"));
                    strikeHtml.setAttribute("class", strikeClassName);
                    html = strikeHtml;
                    break;
                }
            }
        }

        html.appendChild(new HtmlTextGenerator(segment.text));
    }

    return fragmentHtml;
}

function getContentForMessage(message: MessageModel, messageNoun: string): ContentWithReferences {
    switch (message.payload.type) {
        case "Content": {
            return {
                doc: cutMessageContentPayload({
                    payload: message.payload,
                    stream: message.stream,
                }),
                references: message.payload.content.references,
            };
        }
        case "Deleted": {
            return {
                doc: createSimpleMessageContent(`Deleted ${messageNoun}`),
                references: emptyContentReferences,
            };
        }
        default:
            throw exhaustive(message.payload);
    }
}

/**
 * Get the content to render in a reply preview of a message. A content payload
 * will be truncated to enough content to fill a single line. A deleted payload
 * will show a placeholder informing the user the message is deleted.
 *
 * For messages that only have files (no text content), the preview will be the
 * file nouns (e.g. "Image" or "Image. Image 2. Image 3").
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
    // For file-only messages (Content with empty doc but files), show file type
    // labels.
    if (
        message.payload.type === "Content" &&
        message.payload.files.length > 0 &&
        isContentEmpty(cutMessageContentPayload({payload: message.payload, stream: message.stream}))
    ) {
        return getTruncatedMessageContentForReplyPreviewWithOnlyFiles(message.payload.files);
    }

    return getTruncatedMessageContentForReplyPreviewBase(get, {
        content: getContentForMessage(message, messageNoun),
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });
}

/**
 * Get the content to render in a reply preview of a message. A content payload
 * will be truncated to enough content to fill a single line. A deleted payload
 * will show a placeholder informing the user the message is deleted.
 */
export function getTruncatedMessageContentForReplyHtmlGeneratorPreview(
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
): HtmlFragmentGenerator {
    return getTruncatedMessageContentForReplyHtmlGeneratorPreviewBase(get, {
        content: getContentForMessage(message, messageNoun),
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });
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

export function getTruncatedMessagesRangeContentForReplyHtmlGeneratorPreview(
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
): HtmlFragmentGenerator {
    return getTruncatedMessageContentForReplyHtmlGeneratorPreviewBase(get, {
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
