import {Node} from "prosemirror-model";
import {intoApiContentSnippetInlineElementMarks} from "~/server/api/content/into_api_content.js";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {getContentReferences} from "~/server/content/get_content_references.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageContentPayloadParentResponse,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippetPreservingMarks} from "~/shared/content/print_content_single_line_text_snippet.js";
import {truncateContentForMessageReplyPreview} from "~/shared/content/truncate_content_for_message_reply_preview.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function intoApiMessageContentPayloadParent(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    parent: {
        authorId: AccountId;
        content: Node;
    } & (
        | {type: "Message"; index: number}
        | {type: "MessagesRange"; startIndex: number; endIndex: number}
        | {type: "PostRange"}
    ),
): Promise<ApiMessageContentPayloadParentResponse> {
    const referencesContext = context.dynamo.unexpectStrongReadConsistency();

    const [author, contentSnippet] = await runAllPromises([
        getApiAccount(referencesContext, spaceId, parent.authorId, {
            consistency: "StrongWithinCache",
        }),
        intoApiContentSnippet(referencesContext, spaceId, parent.content),
    ]);

    switch (parent.type) {
        case "Message": {
            return {
                type: "Message",
                index: parent.index,
                contentSnippet,
                author,
            };
        }
        case "MessagesRange": {
            return {
                type: "Message",
                index: parent.startIndex,
                endIndex: parent.endIndex,
                contentSnippet,
                author,
            };
        }
        case "PostRange": {
            return {
                type: "Post",
                contentSnippet,
                author,
            };
        }
        default:
            throw exhaustive(parent);
    }
}

async function getContentSnippetWithReferences(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    content: Node,
): Promise<{contentSnippet: ContentWithReferences; isTruncated: boolean}> {
    const contentSnippetWithoutReferences = truncateContentForMessageReplyPreview(content);

    const references = await getContentReferences(
        context,
        spaceId,
        "AssertHasNoFiles",
        getContentReferencedIdsForNode(contentSnippetWithoutReferences),
    );

    return {
        contentSnippet: {
            doc: contentSnippetWithoutReferences,
            references,
        },
        isTruncated: content.nodeSize !== contentSnippetWithoutReferences.nodeSize,
    };
}

async function intoApiContentSnippet(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    content: Node,
): Promise<ApiMessageContentPayloadParentContentSnippet> {
    const {
        contentSnippet: {doc: contentSnippet, references},
        isTruncated,
    } = await getContentSnippetWithReferences(context, spaceId, content);

    const segmentsWithMarks = printContentSingleLineTextSnippetPreservingMarks(contentSnippet, {
        shouldPreserveMark: mark => mark.type.name === "code" || mark.type.name === "strike",
        getAccountIfExists: accountId => references.accountById.get(accountId)?.initialData ?? null,
        getSearchEntityIfExists: entityId => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;

            const {media} = entity.entity.initialData;
            return {
                isPrivate: false,
                title: entity.entity.initialData.title,
                getAccountMediaShortName:
                    media && media.type === "Account"
                        ? () => getAccountShortNameWithoutFullNameTooltip(media.account.initialData)
                        : null,
            };
        },
        getFileIfExists: fileId => references.fileById?.get(fileId)?.file.initialData ?? null,
    });

    return {
        elements: segmentsWithMarks.map(segment => ({
            type: "Text",
            text: segment.text,
            marks:
                segment.marks.length > 0
                    ? intoApiContentSnippetInlineElementMarks(segment.marks)
                    : undefined,
        })),
        isTruncated,
    };
}
