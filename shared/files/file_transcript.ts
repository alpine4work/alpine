import {FileProcessorErrorSchema} from "~/shared/files/file_processor_error.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Transcript processing state for media files.
 *
 * The transcript JSON itself is stored in R2 at
 * `${spaceId}/${fileId}.transcript.json`. This slot only communicates whether a
 * transcript will exist and whether the client should keep polling for it.
 */
export const FileTranscriptSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        isProcessing: Schema.value(true),
    }),
    Schema.result(
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
        }),
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
        }),
    ),
);

export type FileTranscript = SchemaType<typeof FileTranscriptSchema>;
