import {ApiPaths} from "~/server/api/internal/shared/api_paths_type.js";
import {getFileFromAnyAttachment} from "~/server/files/data/get_file_from_any_attachment.js";
import {unknownFileId} from "~/shared/api/content/unknown_file_id.js";
import {FileId} from "~/shared/id/types/id_types.js";

// 1x1 transparent PNG used as the response for unknownFileId. API consumers never
// need to handle unknownFileId specially; requesting it just returns an empty
// placeholder image.
const transparentPixelPng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82,
]);

const transparentPixelPngDataUrl =
    "data:image/png;base64," + Buffer.from(transparentPixelPng).toString("base64");

export const apiFilesPaths: Pick<ApiPaths, keyof ApiPaths & `/files/${string}`> = {
    "/files/{id}": {
        get: async (context, {pathParameters}) => {
            const fileId: FileId = pathParameters.id;

            if (fileId === unknownFileId) {
                return {
                    content: {
                        id: unknownFileId,
                        contentType: "image/png",
                        contentLength: transparentPixelPng.byteLength,
                        signedUrl: transparentPixelPngDataUrl,
                        isUploading: false,
                    },
                };
            }

            const file = await getFileFromAnyAttachment(context, fileId);

            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
                fileId,
            );

            return {
                content: {
                    id: file.id,
                    contentType: file.contentType,
                    contentLength: file.contentLength,
                    signedUrl: signedUrl.toString(),
                    isUploading: file.initialData.isUploading,
                },
            };
        },
    },

    "/files/{id}/content": {
        get: async (context, {pathParameters}) => {
            const fileId: FileId = pathParameters.id;

            if (fileId === unknownFileId) {
                return {
                    response: new Response(transparentPixelPng, {
                        status: 200,
                        headers: {
                            "content-type": "image/png",
                            "content-length": String(transparentPixelPng.byteLength),
                            "cache-control": "public, max-age=31536000, immutable",
                        },
                    }),
                };
            }

            const {spaceId} = await getFileFromAnyAttachment(context, fileId);

            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                spaceId,
                fileId,
            );

            return {
                response: new Response(null, {
                    status: 302,
                    headers: {
                        location: signedUrl.toString(),
                    },
                }),
            };
        },
    },
};
