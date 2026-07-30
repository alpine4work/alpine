import {basename, dirname} from "path";

export const fileProcessWhisperLocalModelDirectoryName = "file_process_whisper_base_en";
export const fileProcessWhisperRemoteModelName = "Xenova/whisper-base.en";

export type FileProcessWhisperModelLoading = {
    readonly allowRemoteModels: boolean;
    readonly localModelPath?: string;
    readonly modelName: string;
};

/**
 * `@xenova/transformers` treats the pipeline model argument as a model ID and
 * resolves it under `env.localModelPath` when loading locally.
 */
export function getFileProcessWhisperModelLoading(
    localModelDirectoryPathIfExists: string | undefined,
): FileProcessWhisperModelLoading {
    if (localModelDirectoryPathIfExists === undefined) {
        return {
            allowRemoteModels: true,
            modelName: fileProcessWhisperRemoteModelName,
        };
    }

    return {
        allowRemoteModels: false,
        localModelPath: dirname(localModelDirectoryPathIfExists),
        modelName: basename(localModelDirectoryPathIfExists),
    };
}
