import {FileProcessorErrorSchema} from "~/shared/files/file_processor_error.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Transcript processing state for media files.
 *
 * The transcript JSON itself is stored in R2 at
 * `${spaceId}/${fileId}.transcript.json`. This slot communicates whether a
 * transcript exists, whether transcript generation is still processing, whether
 * transcript generation completed without a transcript to store, or whether
 * transcript generation failed.
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
            isUnavailable: Schema.value(true).optional(),
        }),
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
        }),
    ),
);

export type FileTranscript = SchemaType<typeof FileTranscriptSchema>;
