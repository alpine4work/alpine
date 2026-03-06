import {ImporterDevelopmentContextModule} from "~/server/importer/development/importer_development_context_module.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

/**
 * Development-only endpoint for receiving file uploads that would normally go to
 * S3 in production.
 *
 * This endpoint is called by the client when uploading import files (e.g., Notion
 * exports) in development. The `ImporterDevelopmentContextModule` generates
 * presigned URLs pointing to this endpoint instead of S3.
 *
 * Files are saved to: `{devEnvPaths.data}/import-uploads/{importKey}`
 *
 * After uploading, the client calls the `finishedNotionImportUpload` RPC to
 * trigger validation. This is the same flow in both dev and production, making it
 * simpler to debug and maintain (no Lambda or S3 event notifications needed).
 */
export async function action({request, params, context}: LoaderArgs) {
    if (process.env.NODE_ENV === "production") {
        return new Response("Not Found", {status: 404});
    }

    // The splat param captures everything after /dev/import-upload/ e.g.,
    // /dev/import-upload/spa_123/nim_456 -> "spa_123/nim_456"
    const importKey = params["*"];
    if (!importKey) {
        return new Response("Missing import key", {status: 400});
    }

    if (request.method !== "PUT") {
        return new Response("Method not allowed. Use PUT.", {status: 405});
    }

    const body = await request.arrayBuffer();
    const data = new Uint8Array(body);

    // In development, the importer context module is ImporterDevelopmentContextModule
    // which has the writeUploadedFile method. Given this route is only available in
    // development, we can safely cast to ImporterDevelopmentContextModule.
    const importer = context.importer as unknown as ImporterDevelopmentContextModule;
    await importer.writeUploadedFile(importKey, data);

    // The client will call the finishedNotionImportUpload RPC after this upload
    // completes to trigger validation. No need to trigger the job here.
    return new Response("OK", {
        status: 200,
        headers: {
            "content-type": "text/plain",
            // Allow CORS for local development
            "access-control-allow-origin": "*",
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
                "access-control-max-age": "3600",
            },
        });
    }

    return new Response("Use PUT to upload files", {status: 405});
}
