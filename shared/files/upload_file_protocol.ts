import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileAttachmentTargetSchema} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type UploadFileResponse = SchemaType<typeof UploadFileResponseSchema>;

export const UploadFileResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        signedUrlSearch: Schema.string,
        file: FileModel.schema,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export type CreateFileMultipartUploadRequest = SchemaType<
    typeof CreateFileMultipartUploadRequestSchema
>;

export const CreateFileMultipartUploadRequestSchema = Schema.object({
    fileId: Schema.id<FileId>().nullable(),
    contentType: Schema.string,
    contentLength: Schema.integer,
    attachTarget: FileAttachmentTargetSchema.nullable(),
});

export type CreateFileMultipartUploadResponse = SchemaType<
    typeof CreateFileMultipartUploadResponseSchema
>;

export const CreateFileMultipartUploadResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        fileId: Schema.id<FileId>(),
        uploadId: Schema.string,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export type PutFileMultipartUploadPartResponse = SchemaType<
    typeof PutFileMultipartUploadPartResponseSchema
>;

export const PutFileMultipartUploadPartResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        partNumber: Schema.integer,
        etag: Schema.string,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export type CompleteFileMultipartUploadRequestPart = SchemaType<
    typeof CompleteFileMultipartUploadRequestPartSchema
>;

export const CompleteFileMultipartUploadRequestPartSchema = Schema.object({
    partNumber: Schema.integer,
    etag: Schema.string,
});

export type CompleteFileMultipartUploadRequest = SchemaType<
    typeof CompleteFileMultipartUploadRequestSchema
>;

export const CompleteFileMultipartUploadRequestSchema = Schema.object({
    parts: Schema.array(CompleteFileMultipartUploadRequestPartSchema),
});
