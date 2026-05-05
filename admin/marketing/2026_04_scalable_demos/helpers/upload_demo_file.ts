import {stringifyCookie} from "cookie";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {getPathFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

export async function uploadDemoFile(
    tokenAgent: TokenAgent,
    session: TestSpaceSession,
    path: string,
    attachmentTarget: FileAttachmentTarget,
): Promise<FileModel> {
    const contentType = assertExists(getPathFileContentTypeIfExists(path));

    const file = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/admin/marketing/2026_04_scalable_demos/fixtures", path),
    );

    const url = new URL(
        `/api/files/${session.space.id}/upload`,
        session.context.constants.edgeServiceUrl,
    );

    url.searchParams.set("target", serializeFileAttachmentTargetString(attachmentTarget));

    const responseBody = await fetchWithTracer(
        session.context.tracer.getTracer(),
        url,
        {
            serviceName: "EdgeService",
            method: "POST",
            route: "/api/files/:spaceId/upload",
            headers: {
                "content-type": contentType,
                "content-length": String(file.length),
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
            const responseBody = UploadFileResponseSchema.deserialize(await response.json());
            if (!responseBody.ok) throw responseBody.error;

            return responseBody;
        },
    );

    return responseBody.file;
}
