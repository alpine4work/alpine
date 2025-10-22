import {Node} from "prosemirror-model";
import {Fragment, ReactNode} from "react";
import {AccountRegistry} from "~/client/accounts/account_registry.js";
import {FileRegistry} from "~/client/content/file_registry.js";
import {printContentSingleLineTextSnippetPreservingMarksForClient} from "~/client/content/print_content_single_line_text_snippet_for_client.js";
import {SearchEntityRegistry} from "~/client/search/core/search_entity_registry.js";
import {
    ContentReferences,
    emptyContentReferences,
    mergeContentReferences,
} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {
    boldClassName,
    codeClassName,
    italicClassName,
    strikeClassName,
} from "~/shared/design/core/constant_class_names.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    MessageContentWithReferences,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
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
        content: MessageContentWithReferences;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): ReactNode {
    const segments = printContentSingleLineTextSnippetPreservingMarksForClient(
        get,
        {
            doc: getContentSnippet(content.doc.resolve(0), 1, {
                // `printContentSingleLineTextSnippet()` collapses newlines. So also consider
                // newlines to be collapsed when generating a snippet.
                ignoreLineBreaks: true,
            }),
            references: content.references,
        },
        {
            shouldPreserveMark: mark =>
                mark.type.name === "bold" ||
                mark.type.name === "italic" ||
                mark.type.name === "code" ||
                mark.type.name === "strike",
            accountRegistry,
            searchEntityRegistry,
            fileRegistry,
        },
    );

    return segments.map((segment, i) => {
        let node: ReactNode = segment.text;

        for (const mark of segment.marks) {
            switch (mark.type.name) {
                case "bold": {
                    node = <strong className={boldClassName}>{node}</strong>;
                    break;
                }
                case "italic": {
                    node = <em className={italicClassName}>{node}</em>;
                    break;
                }
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
                    doc: cutMessageContentPayload(message),
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

export function getTruncatedMessagesRangeContentForReplyPreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        messages,
        startVersion,
        startPos,
        endVersion,
        endPos,
        messageNoun,
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        messages: ReadonlyArray<MessageModel>;
        startVersion: number;
        startPos: number;
        endVersion: number;
        endPos: number;
        messageNoun: string;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): ReactNode {
    const startMessage = messages[0]!;
    const endMessage = messages[messages.length - 1]!;

    let startPayload: {type: "Deleted"} | {type: "Content"; content: MessageContentWithReferences};

    let endPayload:
        | {type: "Deleted"}
        | {type: "Content"; content: MessageContentWithReferences}
        | undefined;

    if (startMessage.index === endMessage.index) {
        switch (startMessage.payload.type) {
            case "Deleted": {
                startPayload = startMessage.payload;
                break;
            }
            case "Content": {
                const version = startMessage.payload.contentUpdate?.mappings.length ?? 0;

                const mappings =
                    version > startVersion
                        ? startMessage.payload.contentUpdate?.mappings.slice(
                              -(version - startVersion),
                          ) ?? emptyArray
                        : emptyArray;

                let actualStartPos = startPos;
                let actualEndPos = endPos;

                for (const mapping of mappings) {
                    actualStartPos = mapping.map(actualStartPos, 1);
                    actualEndPos = mapping.map(actualEndPos, -1);
                }

                startPayload = {
                    type: "Content",
                    content: {
                        doc: cutMessageContentPayload(startMessage, actualStartPos, actualEndPos),
                        references: startMessage.payload.content.references,
                    },
                };
                break;
            }
            default:
                throw exhaustive(startMessage.payload);
        }
    } else {
        switch (startMessage.payload.type) {
            case "Deleted": {
                startPayload = startMessage.payload;
                break;
            }
            case "Content": {
                const version = startMessage.payload.contentUpdate?.mappings.length ?? 0;

                const mappings =
                    version > startVersion
                        ? startMessage.payload.contentUpdate?.mappings.slice(
                              -(version - startVersion),
                          ) ?? emptyArray
                        : emptyArray;

                let pos = startPos;

                for (const mapping of mappings) {
                    pos = mapping.map(pos, 1);
                }

                startPayload = {
                    type: "Content",
                    content: {
                        doc: cutMessageContentPayload(startMessage, pos),
                        references: startMessage.payload.content.references,
                    },
                };
                break;
            }
            default:
                throw exhaustive(startMessage.payload);
        }

        switch (endMessage.payload.type) {
            case "Deleted": {
                endPayload = endMessage.payload;
                break;
            }
            case "Content": {
                const version = endMessage.payload.contentUpdate?.mappings.length ?? 0;

                const mappings =
                    version > endVersion
                        ? endMessage.payload.contentUpdate?.mappings.slice(
                              -(version - endVersion),
                          ) ?? emptyArray
                        : emptyArray;

                let pos = endPos;

                for (const mapping of mappings) {
                    pos = mapping.map(pos, -1);
                }

                endPayload = {
                    type: "Content",
                    content: {
                        doc: cutMessageContentPayload(endMessage, 0, pos),
                        references: endMessage.payload.content.references,
                    },
                };
                break;
            }
            default:
                throw exhaustive(endMessage.payload);
        }
    }

    const payloads = [startPayload, ...messages.slice(1, -1).map(message => message.payload)];

    if (endPayload !== undefined) payloads.push(endPayload);

    const docs: Array<MessageContent> = [];
    let references: ContentReferences | null = null;

    for (const payload of payloads) {
        switch (payload.type) {
            case "Content": {
                docs.push(payload.content.doc);
                if (references === null) {
                    references = payload.content.references;
                } else {
                    references = mergeContentReferences(references, payload.content.references);
                }
                break;
            }
            case "Deleted": {
                docs.push(createSimpleMessageContent(`Deleted ${messageNoun}`));
                break;
            }
            default:
                throw exhaustive(payload);
        }
    }

    return getTruncatedMessageContentForReplyPreviewBase(get, {
        content: {
            doc: assertMessageContent(
                MessageContentProsemirrorSchema.nodes.doc.create(
                    null,
                    docs.flatMap(doc => doc.content.content),
                ),
            ),
            references: references ?? emptyContentReferences,
        },
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    });
}

/**
 * Cut the message content. If the message is a stream then we include stream
 * parts in the cut content.
 */
function cutMessageContentPayload(
    message: MessageModel<string>,
    from?: number,
    to?: number,
): MessageContent {
    assert(message.payload.type === "Content");

    const {
        payload: {
            content: {doc: content},
        },
        stream,
    } = message;

    if (stream === null) {
        return assertMessageContent(
            content.cut(
                clamp(0, from ?? 0, content.content.size),
                clamp(0, to ?? content.content.size, content.content.size),
            ),
        );
    }

    const nodes: Array<Node> = [];

    if (!isContentBodyEmpty(content)) {
        for (const node of content.content.content) {
            nodes.push(node);
        }
    }

    for (const part of stream.parts) {
        if (part.payload.type === "Content") {
            for (const node of part.payload.content.content.content) {
                nodes.push(node);
            }
        }
    }

    const contentWithStream = MessageContentProsemirrorSchema.nodes.doc.create({}, nodes);

    return assertMessageContent(
        contentWithStream.cut(
            clamp(0, from ?? 0, contentWithStream.content.size),
            clamp(0, to ?? contentWithStream.content.size, contentWithStream.content.size),
        ),
    );
}
