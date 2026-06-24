import fsSync from "fs";
import fs from "fs/promises";
import {dirname, join as joinPath} from "path";

type FileProcessWhisperModelFile = {
    readonly relativePath: string;
    readonly sourceRepositoryName: string;
};

const fileProcessWhisperModelBundleVersion = "xenova-onnx-2026-05-29";

/**
 * Files required by our current `@xenova/transformers` Whisper ASR path.
 *
 * We intentionally do **not** mirror the full upstream model repo here. The
 * upstream repo contains many alternative ONNX exports for the same model family,
 * while our runtime only uses one quantized encoder + merged decoder pair plus the
 * tokenizer / processor / generation config files.
 *
 * Keep this list in sync with:
 *
 * - the `@xenova/transformers` version in `package.json`
 * - the model-loading path in `process_file_analysis.ts`
 * - `server/files/processor/whisper_base_en/README.md`
 */
const fileProcessWhisperModelFiles: ReadonlyArray<FileProcessWhisperModelFile> = [
    {
        relativePath: "added_tokens.json",
        sourceRepositoryName: "file_process_whisper_base_en_added_tokens",
    },
    {
        relativePath: "config.json",
        sourceRepositoryName: "file_process_whisper_base_en_config",
    },
    {
        relativePath: "generation_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_generation_config",
    },
    {
        relativePath: "merges.txt",
        sourceRepositoryName: "file_process_whisper_base_en_merges",
    },
    {
        relativePath: "normalizer.json",
        sourceRepositoryName: "file_process_whisper_base_en_normalizer",
    },
    {
        relativePath: "preprocessor_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_preprocessor_config",
    },
    {
        relativePath: "special_tokens_map.json",
        sourceRepositoryName: "file_process_whisper_base_en_special_tokens_map",
    },
    {
        relativePath: "tokenizer.json",
        sourceRepositoryName: "file_process_whisper_base_en_tokenizer",
    },
    {
        relativePath: "tokenizer_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_tokenizer_config",
    },
    {
        relativePath: "vocab.json",
        sourceRepositoryName: "file_process_whisper_base_en_vocab",
    },
    {
        relativePath: "onnx/encoder_model_quantized.onnx",
        sourceRepositoryName: "file_process_whisper_base_en_encoder_model_quantized",
    },
    {
        relativePath: "onnx/decoder_model_merged_quantized.onnx",
        sourceRepositoryName: "file_process_whisper_base_en_decoder_model_merged_quantized",
    },
];

export async function materializePackagedFileProcessWhisperModelPathIfExists({
    outputDirectoryPath,
    runfilesDirectoryPath,
}: {
    outputDirectoryPath: string;
    runfilesDirectoryPath: string;
}): Promise<string | undefined> {
    const readyPath = joinPath(outputDirectoryPath, ".ready");
    if ((await readReadyVersionIfExists(readyPath)) === fileProcessWhisperModelBundleVersion) {
        return outputDirectoryPath;
    }

    const sourceFiles = fileProcessWhisperModelFiles.map(file => {
        const sourcePath = joinPath(
            runfilesDirectoryPath,
            file.sourceRepositoryName,
            "file",
            file.relativePath,
        );

        return {
            outputPath: joinPath(outputDirectoryPath, file.relativePath),
            sourcePath,
        };
    });

    // Only claim success if every required file is present. This keeps us from
    // constructing a partial local model directory that would fail later in a
    // harder-to-debug way.
    if (!sourceFiles.every(file => fsSync.existsSync(file.sourcePath))) {
        return undefined;
    }

    await fs.rm(outputDirectoryPath, {force: true, recursive: true});
    await fs.mkdir(outputDirectoryPath, {recursive: true});

    for (const sourceFile of sourceFiles) {
        await fs.mkdir(dirname(sourceFile.outputPath), {recursive: true});
        await fs.copyFile(sourceFile.sourcePath, sourceFile.outputPath);
    }

    await fs.writeFile(readyPath, fileProcessWhisperModelBundleVersion);
    return outputDirectoryPath;
}

async function readReadyVersionIfExists(readyPath: string): Promise<string | undefined> {
    if (!fsSync.existsSync(readyPath)) {
        return undefined;
    }

    try {
        return await fs.readFile(readyPath, "utf8");
    } catch {
        return undefined;
    }
}
