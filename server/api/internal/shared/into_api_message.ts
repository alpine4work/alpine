import {getApiAccount} from "~/server/api/internal/shared/get_api_account.js";
import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {
    ApiMessage,
    ApiMessagePayload,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessagePayload} from "~/shared/messaging/message_model.js";

export async function intoApiMessage(
    context: ServerBotActionContext,
    {
        spaceId,
        index,
        authorId,
        createdTime,
        payload,
    }: {
        spaceId: SpaceId;
        index: number;
        authorId: AccountId;
        createdTime: Date;
        payload: MessagePayload;
    },
): Promise<ApiMessage> {
    const [author, payloadWithReferences] = await runAllPromises([
        getApiAccount(context, spaceId, authorId, {consistency: "StrongWithinCache"}),
        intoApiMessagePayload(context, spaceId, payload),
    ]);

    return {
        index,
        author,
        createdTime: serializeDateString(createdTime),
        payload: payloadWithReferences,
    };
}

async function intoApiMessagePayload(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    payload: MessagePayload,
): Promise<ApiMessagePayload> {
    switch (payload.type) {
        case "Deleted": {
            return {type: "Deleted"};
        }
        case "Content":
            return {
                type: "Content",
                parent:
                    payload.parentMessageIndex !== null
                        ? {type: "Message", index: payload.parentMessageIndex}
                        : undefined,
                content: await intoApiContentWithReferences(context, spaceId, payload.content),
            };
        default:
            throw exhaustive(payload);
    }
}
