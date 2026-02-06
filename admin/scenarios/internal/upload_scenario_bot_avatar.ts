import {stringifyCookie} from "cookie";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {BotId} from "~/shared/id/types/id_types.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function uploadScenarioBotAvatar(
    tokenAgent: TokenAgent,
    session: TestSession,
    botId: BotId,
    path: string,
): Promise<void> {
    const contentType = assertExists(getPathFileContentTypeIfExists(path));

    const file = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/admin/scenarios/fixtures", path),
    );

    await fetchWithTracer(
        session.context.tracer.getTracer(),
        new URL(`/api/avatar/bot/${botId}`, session.context.constants.edgeServiceUrl),
        {
            serviceName: "EdgeService",
            route: "/api/avatar/bot/:botId",
            method: "POST",
            headers: {
                "content-type": contentType,
                "content-length": file.length.toString(),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: new Uint8Array(file),
        },
        async response => {
            const responseData = await response.json();
            const responseBody = UploadAvatarResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
        },
    );
}
