import {Node} from "prosemirror-model";
import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {getApiContentRangeSpanningContent} from "~/shared/api/content/get_api_content_range_spanning_content.js";
import {sliceApiContentRange} from "~/shared/api/content/slice_api_content_range.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiMessageContentPayloadParentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
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
                author,
                contentSnippet,
            };
        }
        case "MessagesRange": {
            return {
                type: "Message",
                index: parent.startIndex,
                endIndex: parent.endIndex,
                author,
                contentSnippet,
            };
        }
        case "PostRange": {
            return {
                type: "Post",
                author,
                contentSnippet,
            };
        }
        default:
            throw exhaustive(parent);
    }
}

async function intoApiContentSnippet(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    content: Node,
): Promise<ApiContentResponseWithoutKeys> {
    // The parent `content` was already cut down by our data layer to just the range of
    // content being replied to. Convert the content and slice the whole thing with
    // `sliceApiContentRange()` so the snippet has the exact shape a slice of the
    // parent message content would have. Which guarantees `findApiContentRanges()`
    // will find the snippet in the parent message content when a reply is recreated
    // from the snippet.
    //
    // The content keys we encode here never leave this function since
    // `sliceApiContentRange()` removes them.
    const apiContent = await intoApiContentWithReferences(context, {
        spaceId,
        fileAuthorizer: "AssertHasNoFiles",
        content,
        contentKeyEncoder: new ApiContentKeyEncoder({
            entityId: "MessageContentPayloadParentContentSnippet",
            version: 0,
        }),
    });

    const range = getApiContentRangeSpanningContent(apiContent);
    if (range === null) return {elements: []};

    const contentSnippet = sliceApiContentRange(apiContent, range);
    assert(contentSnippet.ok);
    return contentSnippet.value;
}
