import {FileProcessorActionContext} from "~/server/files/data/file_processor_context.js";
import {
    FileContentTypeSupportedForAnalysis,
    ProcessFileAnalysisTranscriptResult,
    processFileAnalysis,
} from "~/server/files/processor/process_file_analysis.js";
import {FileAnalysisResult} from "~/shared/files/file_analysis.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

export type FileProcessorAnalysisPromises = {
    readonly analysisPromise: Promise<FileAnalysisResult | null>;
    readonly transcriptPromise?: Promise<ProcessFileAnalysisTranscriptResult | null>;
};

type CreateFileProcessorAnalysisPromisesOptions = {
    readonly contentType: FileContentTypeSupportedForAnalysis;
    readonly fileId: FileId;
    readonly inputPathIfExists?: string | Promise<string | undefined> | (() => Promise<string>);
    readonly parentTemporaryDirectoryPath: string;
    readonly signal: AbortSignal;
    readonly spaceId: SpaceId;
};

/**
 * Create processor result promises for file analysis and optional transcripts.
 */
export function createFileProcessorAnalysisPromises(
    context: FileProcessorActionContext,
    options: CreateFileProcessorAnalysisPromisesOptions & {readonly hasTranscript: true},
): FileProcessorAnalysisPromises & {
    readonly transcriptPromise: Promise<ProcessFileAnalysisTranscriptResult | null>;
};

export function createFileProcessorAnalysisPromises(
    context: FileProcessorActionContext,
    options: CreateFileProcessorAnalysisPromisesOptions & {readonly hasTranscript: false},
): FileProcessorAnalysisPromises & {readonly transcriptPromise?: undefined};

export function createFileProcessorAnalysisPromises(
    context: FileProcessorActionContext,
    {
        contentType,
        fileId,
        hasTranscript,
        inputPathIfExists,
        parentTemporaryDirectoryPath,
        signal,
        spaceId,
    }: CreateFileProcessorAnalysisPromisesOptions & {readonly hasTranscript: boolean},
): FileProcessorAnalysisPromises {
    const transcriptPromiseResolver = hasTranscript
        ? createPromiseResolver<ProcessFileAnalysisTranscriptResult>()
        : null;
    let hasReportedTranscriptResult = false;

    // `processFileAnalysis()` performs transcript work before tag generation for
    // audio/video. Keep the transcript processor slot independent so a later tag
    // failure does not reopen an already-finished transcript slot.
    const reportTranscriptResult = (result: ProcessFileAnalysisTranscriptResult) => {
        assert(transcriptPromiseResolver !== null);
        if (hasReportedTranscriptResult) return;
        hasReportedTranscriptResult = true;

        if (result.ok) {
            transcriptPromiseResolver.resolve(result);
        } else {
            transcriptPromiseResolver.reject(result.error);
        }
    };

    const analysisPromise = (async () => {
        // Some processors have to derive an analysis input from preview output. Make that
        // work lazy so disabled spaces do not create temp files or observe preview
        // failures through unused analysis promises.
        const inputPath =
            typeof inputPathIfExists === "function"
                ? await inputPathIfExists()
                : await inputPathIfExists;

        const result = await processFileAnalysis(context, {
            contentType,
            fileId,
            inputPathIfExists: inputPath,
            onTranscriptProcessed:
                transcriptPromiseResolver !== null ? reportTranscriptResult : undefined,
            parentTemporaryDirectoryPath,
            signal,
            spaceId,
        });

        if (!result.ok) {
            if (transcriptPromiseResolver !== null && !hasReportedTranscriptResult) {
                reportTranscriptResult(result);
            }
            throw result.error;
        }

        const analysis = result.analysis;

        assert(
            transcriptPromiseResolver === null || hasReportedTranscriptResult,
            "Expected file analysis to report transcript processing result",
        );

        return analysis;
    })();

    return {
        analysisPromise,
        ...(transcriptPromiseResolver !== null
            ? {transcriptPromise: transcriptPromiseResolver.promise}
            : {}),
    };
}
