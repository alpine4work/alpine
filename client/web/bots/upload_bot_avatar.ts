import {AppContext} from "~/client/web/context/app_context.js";
import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

/**
 * Uploads a new avatar image for a bot and returns the new `AvatarModel`. Only the
 * bot's owner may upload an avatar (see `finishUploadingBotAvatar()`).
 */
export async function uploadBotAvatar(
    context: AppContext,
    botId: BotId,
    file: File,
): Promise<AvatarModel> {
    return await fetchWithTracer(
        context.tracer.getTracer(),
        new URL(`/api/avatar/bot/${botId}`, window.location.href),
        {
            serviceName: "EdgeService",
            route: "/api/avatar/bot/:botId",
            method: "POST",
            headers: {
                "content-type": file.type,
                "content-length": file.size.toString(),
            },
            body: file,
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;

            if (responseBody.type !== "UploadBotAvatar") {
                throw new InternalError(
                    quote`Unexpected response type \u201C${responseBody.type}\u201D`,
                );
            }

            return assertExists(responseBody.bot.avatar);
        },
    );
}
