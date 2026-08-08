import {stringifyCookie} from "cookie";
import {settingsDefaultKnownBotAccountModelDatas} from "~/server/bots/settings_default_known_bot_account_model_data.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {getAvatarContentType} from "~/shared/avatar/get_avatar_content_type.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

export async function uploadDemoSpaceBotAvatar(
    tokenAgent: TokenAgent,
    session: TestSession,
    botId: BotId,
    knownBotKey: keyof typeof settingsDefaultKnownBotAccountModelDatas,
): Promise<void> {
    const {content} = settingsDefaultKnownBotAccountModelDatas[knownBotKey].get().avatar;

    await fetchWithTracer(
        session.context.tracer.getTracer(),
        new URL(`/api/avatar/bot/${botId}`, session.context.constants.edgeServiceUrl),
        {
            serviceName: "EdgeService",
            route: "/api/avatar/bot/:botId",
            method: "POST",
            headers: {
                "content-type": getAvatarContentType(content),
                "content-length": content.length.toString(),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: content,
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
        },
    );
}
