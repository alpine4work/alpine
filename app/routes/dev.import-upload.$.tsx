import {createHash} from "crypto";

import {ImporterDevelopmentContextModule} from "~/server/importer/development/importer_development_context_module.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

/**
 * Development-only endpoint for receiving file uploads that would normally go to
 * S3 in production.
 *
 * This endpoint is called by the client when uploading import file parts (e.g.,
 * Notion exports) in development. The `ImporterDevelopmentContextModule` generates
 * presigned URLs pointing to this endpoint instead of S3.
 *
 * ## Part uploads
 *
 * The splat param captures everything after /dev/import-upload/:
 *
 * - `{spaceId}/{importId}/part/{partNumber}` → saves part to
 *   `{importKey}.parts/{partNumber}`
 *
 * Part uploads return an `ETag` header (hash of the part data) so the client can
 * collect ETags for completing the multipart upload.
 */
export async function action({request, params, context}: LoaderArgs) {
    if (process.env.NODE_ENV === "production") {
        return new Response("Not Found", {status: 404});
    }

    const splatPath = params["*"];
    if (!splatPath) {
        return new Response("Missing import key", {status: 400});
    }

    if (request.method !== "PUT") {
        return new Response("Method not allowed. Use PUT.", {status: 405});
    }

    const body = await request.arrayBuffer();
    const data = new Uint8Array(body);

    // In development, the importer context module is ImporterDevelopmentContextModule
    // which has the writePartFile method. Given this route is only available in
    // development, we can safely cast to ImporterDevelopmentContextModule.
    const importer = context.importer as unknown as ImporterDevelopmentContextModule;

    // Parse the path to detect part uploads: {importKey}/part/{partNumber}
    const partMatch = splatPath.match(/^(.+)\/part\/(\d+)$/);
    if (!partMatch) {
        return new Response("Invalid upload path. Expected {importKey}/part/{partNumber}", {
            status: 400,
        });
    }

    const importKey = partMatch[1]!;
    const partNumber = parseInt(partMatch[2]!, 10);

    await importer.writePartFile(importKey, partNumber, data);

    // Generate an ETag from the part data so the client can use it when completing the
    // multipart upload.
    const hash = createHash("md5").update(data).digest("hex");
    // eslint-disable-next-line cyberworlds/string-quotes -- ETag format requires straight quotes
    const etag = `"${hash}"`;

    return new Response("OK", {
        status: 200,
        headers: {
            "content-type": "text/plain",
            etag,
            // Allow CORS for local development
            "access-control-allow-origin": "*",
            "access-control-expose-headers": "ETag",
        },
    });
}

/**
 * Handle CORS preflight requests for the upload endpoint.
 */
export async function loader({request}: LoaderArgs) {
    if (process.env.NODE_ENV === "production") {
        return new Response("Not Found", {status: 404});
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "PUT, OPTIONS",
                "access-control-allow-headers": "content-type, content-length",
                "access-control-expose-headers": "ETag",
                "access-control-max-age": "3600",
            },
        });
    }

    return new Response("Use PUT to upload files", {status: 405});
}
