import {stringifyCookie} from "cookie";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    FileAttachmentTarget,
    serializeFileAttachmentTargetString,
} from "~/shared/files/file_attachment_target.js";
import {
    FileContentType,
    getPathFileContentTypeIfExists,
} from "~/shared/files/file_content_type.open_source.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

const scenarioFixturesRoot = joinPath(runfilesPath, "cyberworlds/admin/scenarios/fixtures");

export async function uploadScreenshotTestFixtureFile(
    tokenAgent: TokenAgent,
    session: TestSpaceSession,
    path: string | {contentType: FileContentType; content: Uint8Array<ArrayBuffer>},
    attachmentTarget: FileAttachmentTarget | null = null,
) {
    const contentType =
        typeof path === "string"
            ? assertExists(getPathFileContentTypeIfExists(path))
            : path.contentType;

    const content: ArrayBufferView<ArrayBuffer> =
        typeof path === "string"
            ? new Uint8Array(await fs.readFile(joinPath(scenarioFixturesRoot, path)))
            : path.content;

    const url = new URL(
        `/api/files/${session.space.id}/upload`,
        session.context.constants.edgeServiceUrl,
    );
    if (attachmentTarget !== null) {
        url.searchParams.set("target", serializeFileAttachmentTargetString(attachmentTarget));
    }

    const responseBody = await fetchWithTracer(
        session.context.tracer.getTracer(),
        url,
        {
            serviceName: "EdgeService",
            route: "/api/files/:spaceId/upload",
            method: "POST",
            headers: {
                "content-type": contentType,
                "content-length": String(content.byteLength),
                cookie: stringifyCookie({
                    session: await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        session.getTokenPayload(),
                    ),
                }),
            },
            body: content,
        },
        async response => UploadFileResponseSchema.deserialize(await response.json()),
    );

    if (!responseBody.ok) throw responseBody.error;

    return await TestFile.get(session.space, responseBody.file.id);
}
