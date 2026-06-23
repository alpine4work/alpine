import {FileProcessorErrorSchema} from "~/shared/files/file_processor_error.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Maximum analysis result sizes stored directly on the file item.
 *
 * DynamoDB file attributes should stay small because file models are commonly
 * loaded with their attachment targets and pushed through realtime polling.
 */
export const fileAnalysisMaxTagCount = 10;
export const fileAnalysisTagsMaxLength = 256;
export const fileAnalysisTagMaxLength = fileAnalysisTagsMaxLength;
export const fileAnalysisCaptionMaxLength = 256;
export const fileAnalysisDescriptionMaxLength = 1_024;

const fileAnalysisTagSchema = fileAnalysisStringSchema({
    maxLength: fileAnalysisTagMaxLength,
    minLength: 1,
});

export const FileAnalysisResultSchema = Schema.object({
    tags: Schema.array(fileAnalysisTagSchema)
        .maxLength(fileAnalysisMaxTagCount)
        .validation(
            `Expected tags to be ${fileAnalysisTagsMaxLength} characters or fewer`,
            tags => getFileAnalysisTagsLength(tags) <= fileAnalysisTagsMaxLength,
        ),
    caption: fileAnalysisStringSchema({
        maxLength: fileAnalysisCaptionMaxLength,
        minLength: 1,
    }).optional(),
    description: fileAnalysisStringSchema({
        maxLength: fileAnalysisDescriptionMaxLength,
        minLength: 1,
    }).optional(),
});

export type FileAnalysisResult = SchemaType<typeof FileAnalysisResultSchema>;

/**
 * Model-produced, search-oriented analysis for a file.
 *
 * If this field is `null`, this file will never have analysis. If it is non-null,
 * its `isProcessing` state participates in file polling/loading just like
 * `alternative` and `preview`.
 */
export const FileAnalysisSchema = Schema.booleanUnion(
    "isProcessing",
    Schema.object({
        isProcessing: Schema.value(true),
    }),
    Schema.result(
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(true),
            result: FileAnalysisResultSchema,
        }),
        Schema.object({
            isProcessing: Schema.value(false),
            ok: Schema.value(false),
            error: FileProcessorErrorSchema,
        }),
    ),
);

export type FileAnalysis = SchemaType<typeof FileAnalysisSchema>;

function getFileAnalysisTagsLength(tags: ReadonlyArray<string>): number {
    let length = 0;
    for (const tag of tags) {
        length += tag.length;
    }
    return length;
}

function fileAnalysisStringSchema({
    maxLength,
    minLength = 0,
}: {
    maxLength: number;
    minLength?: number;
}) {
    const schema = Schema.string.singleLine().trim().maxLength(maxLength);
    return minLength > 0 ? schema.minLength(minLength) : schema;
}
