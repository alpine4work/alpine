import {BertModel, PretrainedConfig} from "@xenova/transformers";
import {ONNX, executionProviders} from "@xenova/transformers/src/backends/onnx.js";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Creates a model automatically from the `@xenova/transformers` library.
 * Basically the same as `AutoModel.from_pretrained()` but instead of
 * downloading files on-the-fly, we read files downloaded by Bazel from disk.
 */
export async function createTransformersModel(basePath: string) {
    const [configContents, onnxModelQuantizedContents] = await runAllPromises([
        fs.readFile(joinPath(`${basePath}_config`, "file/config.json"), "utf8"),
        fs.readFile(joinPath(`${basePath}_onnx_model_quantized`, "file/onnx/model_quantized.onnx")),
    ]);

    const config = JSON.parse(configContents);

    // Used by `AutoModel` to figure out the right model class.
    // The models we use currently all use `bert` so we hardcode it.
    // https://github.com/xenova/transformers.js/blob/83dfa4718ec99c4566ec89954a0b0544a5a25d78/src/models.js#L4095
    assert(config.model_type === "bert");

    const session = await ONNX.InferenceSession.create(onnxModelQuantizedContents, {
        executionProviders,
    });

    return new BertModel(new PretrainedConfig(config), session);
}
