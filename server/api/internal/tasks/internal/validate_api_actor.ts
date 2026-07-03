import {ApiServiceBotActionContext} from "~/server/api/internal/shared/api_service_context.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function validateApiActor(
    context: ApiServiceBotActionContext,
    {
        spaceId,
        actorId,
    }: {
        spaceId: SpaceId;
        actorId: AccountId | undefined;
    },
) {
    if (actorId === undefined) return;

    if (await isAccountMemberOfSpace(context, spaceId, actorId)) return;

    throw new PermissionDeniedError("API actor must be a member of the space", {
        displayMessage: errorDisplayMessage`API actor must be a member of the space`,
    });
}
