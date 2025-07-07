import {Fragment, ReactNode} from "react";
import {printContentSingleLineTextSnippetPreservingMarksForClient} from "~/client/content/print_content_single_line_text_snippet_for_client.js";
import {
    boldClassName,
    codeClassName,
    italicClassName,
    strikeClassName,
} from "~/shared/content/content_styles.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageModel} from "~/shared/messaging/message_model.js";
import {Store} from "~/shared/store/store.js";

/**
 * Get the content to render in a reply preview of a message. A content payload
 * will be truncated to enough content to fill a single line. A deleted payload
 * will show a placeholder informing the user the message is deleted.
 */
export function getTruncatedMessageContentForReplyPreview(
    get: <Value>(store: Store<Value>) => Value,
    {
        spaceId,
        message,
        messageNoun,
    }: {
        spaceId: SpaceId;
        message: MessageModel;
        messageNoun: string;
    },
): ReactNode {
    switch (message.payload.type) {
        case "Content": {
            const segments = printContentSingleLineTextSnippetPreservingMarksForClient(
                get,
                spaceId,
                {
                    doc: getContentSnippet(message.payload.content.doc.resolve(0), 1),
                    references: message.payload.content.references,
                },
                mark =>
                    mark.type.name === "bold" ||
                    mark.type.name === "italic" ||
                    mark.type.name === "code" ||
                    mark.type.name === "strike",
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
        case "Deleted": {
            return <>Deleted {messageNoun}</>;
        }
        default:
            throw exhaustive(message.payload);
    }
}
