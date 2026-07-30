import {afterEach, expect, test} from "@jest/globals";
import fs from "fs/promises";
import os from "os";
import {dirname, join as joinPath} from "path";

import {materializePackagedFileProcessWhisperModelPathIfExists} from "~/server/files/processor/materialize_packaged_file_process_whisper_model_path_if_exists.js";

const temporaryDirectoryPaths = new Array<string>();

afterEach(async () => {
    for (const temporaryDirectoryPath of temporaryDirectoryPaths) {
        await fs.rm(temporaryDirectoryPath, {force: true, recursive: true});
    }
    temporaryDirectoryPaths.length = 0;
});

test("materializePackagedFileProcessWhisperModelPathIfExists copies all packaged files", async () => {
    const temporaryDirectoryPath = await fs.mkdtemp(
        joinPath(os.tmpdir(), "file_process_whisper_model_"),
    );
    temporaryDirectoryPaths.push(temporaryDirectoryPath);

    const runfilesDirectoryPath = joinPath(temporaryDirectoryPath, "runfiles");
    const outputDirectoryPath = joinPath(temporaryDirectoryPath, "output");

    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "added_tokens.json",
        sourceRepositoryName: "file_process_whisper_base_en_added_tokens",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "config.json",
        sourceRepositoryName: "file_process_whisper_base_en_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "generation_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_generation_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "merges.txt",
        sourceRepositoryName: "file_process_whisper_base_en_merges",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "normalizer.json",
        sourceRepositoryName: "file_process_whisper_base_en_normalizer",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "preprocessor_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_preprocessor_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "special_tokens_map.json",
        sourceRepositoryName: "file_process_whisper_base_en_special_tokens_map",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "tokenizer.json",
        sourceRepositoryName: "file_process_whisper_base_en_tokenizer",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "tokenizer_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_tokenizer_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "vocab.json",
        sourceRepositoryName: "file_process_whisper_base_en_vocab",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "onnx/encoder_model_quantized.onnx",
        sourceRepositoryName: "file_process_whisper_base_en_encoder_model_quantized",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "onnx/decoder_model_merged_quantized.onnx",
        sourceRepositoryName: "file_process_whisper_base_en_decoder_model_merged_quantized",
    });

    const result = await materializePackagedFileProcessWhisperModelPathIfExists({
        outputDirectoryPath,
        runfilesDirectoryPath,
    });

    expect(result).toBe(outputDirectoryPath);
    await expect(
        fs.readFile(joinPath(outputDirectoryPath, "onnx/encoder_model_quantized.onnx"), "utf8"),
    ).resolves.toBe("onnx/encoder_model_quantized.onnx");
    await expect(fs.readFile(joinPath(outputDirectoryPath, ".ready"), "utf8")).resolves.toBe(
        "xenova-onnx-2026-05-29",
    );
});

test("materializePackagedFileProcessWhisperModelPathIfExists refreshes stale materialized files", async () => {
    const temporaryDirectoryPath = await fs.mkdtemp(
        joinPath(os.tmpdir(), "file_process_whisper_model_"),
    );
    temporaryDirectoryPaths.push(temporaryDirectoryPath);

    const runfilesDirectoryPath = joinPath(temporaryDirectoryPath, "runfiles");
    const outputDirectoryPath = joinPath(temporaryDirectoryPath, "output");

    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "added_tokens.json",
        sourceRepositoryName: "file_process_whisper_base_en_added_tokens",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "config.json",
        sourceRepositoryName: "file_process_whisper_base_en_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "generation_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_generation_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "merges.txt",
        sourceRepositoryName: "file_process_whisper_base_en_merges",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "normalizer.json",
        sourceRepositoryName: "file_process_whisper_base_en_normalizer",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "preprocessor_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_preprocessor_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "special_tokens_map.json",
        sourceRepositoryName: "file_process_whisper_base_en_special_tokens_map",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "tokenizer.json",
        sourceRepositoryName: "file_process_whisper_base_en_tokenizer",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "tokenizer_config.json",
        sourceRepositoryName: "file_process_whisper_base_en_tokenizer_config",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "vocab.json",
        sourceRepositoryName: "file_process_whisper_base_en_vocab",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "onnx/encoder_model_quantized.onnx",
        sourceRepositoryName: "file_process_whisper_base_en_encoder_model_quantized",
    });
    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "onnx/decoder_model_merged_quantized.onnx",
        sourceRepositoryName: "file_process_whisper_base_en_decoder_model_merged_quantized",
    });

    await fs.mkdir(joinPath(outputDirectoryPath, "onnx"), {recursive: true});
    await fs.writeFile(joinPath(outputDirectoryPath, "onnx/encoder_model_quantized.onnx"), "stale");
    await fs.writeFile(joinPath(outputDirectoryPath, ".ready"), "stale-version");

    const result = await materializePackagedFileProcessWhisperModelPathIfExists({
        outputDirectoryPath,
        runfilesDirectoryPath,
    });

    expect(result).toBe(outputDirectoryPath);
    await expect(
        fs.readFile(joinPath(outputDirectoryPath, "onnx/encoder_model_quantized.onnx"), "utf8"),
    ).resolves.toBe("onnx/encoder_model_quantized.onnx");
});

test("materializePackagedFileProcessWhisperModelPathIfExists returns undefined if a file is missing", async () => {
    const temporaryDirectoryPath = await fs.mkdtemp(
        joinPath(os.tmpdir(), "file_process_whisper_model_"),
    );
    temporaryDirectoryPaths.push(temporaryDirectoryPath);

    const runfilesDirectoryPath = joinPath(temporaryDirectoryPath, "runfiles");
    const outputDirectoryPath = joinPath(temporaryDirectoryPath, "output");

    await writeRunfile(runfilesDirectoryPath, {
        relativePath: "config.json",
        sourceRepositoryName: "file_process_whisper_base_en_config",
    });

    const result = await materializePackagedFileProcessWhisperModelPathIfExists({
        outputDirectoryPath,
        runfilesDirectoryPath,
    });

    expect(result).toBeUndefined();
    await expect(fs.stat(outputDirectoryPath)).rejects.toThrow();
});

async function writeRunfile(
    runfilesDirectoryPath: string,
    {
        relativePath,
        sourceRepositoryName,
    }: {
        relativePath: string;
        sourceRepositoryName: string;
    },
) {
    const outputPath = joinPath(runfilesDirectoryPath, sourceRepositoryName, "file", relativePath);
    await fs.mkdir(dirname(outputPath), {recursive: true});
    await fs.writeFile(outputPath, relativePath);
}
