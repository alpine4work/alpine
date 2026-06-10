import fs from "fs/promises";
import {join as joinPath} from "path";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";

/**
 * Creates a tokenizer automatically from the `@xenova/transformers` library.
 * Basically the same as `AutoTokenizer.from_pretrained()` but instead of
 * downloading files on-the-fly, we read files downloaded by Bazel from disk.
 */
export async function createTransformersTokenizer(basePath: string) {
    // We dynamically import this models at runtime to avoid bundling
    // `@xenova/transformers`'s native libraries in an `aws_lambda()`.
    //
    // We do the funky `string + cast(string)` syntax so the import path can't be
    // statically analyzed by esbuild.
    const {BertTokenizer}: typeof import("@xenova/transformers") = await import(
        /* @vite-ignore */ "@xenova/" + cast("transformers")
    );

    const [configContents, jsonContents] = await runAllPromises([
        fs.readFile(joinPath(`${basePath}_tokenizer_config`, "file/tokenizer_config.json"), "utf8"),
        fs.readFile(joinPath(`${basePath}_tokenizer`, "file/tokenizer.json"), "utf8"),
    ]);

    const config = JSON.parse(configContents);
    const json = JSON.parse(jsonContents);

    // Used by `AutoTokenizer` to figure out the right tokenizer class. The models we
    // use currently all use `BertTokenizer` so we hardcode it.
    // https://github.com/xenova/transformers.js/blob/83dfa4718ec99c4566ec89954a0b0544a5a25d78/src/tokenizers.js#L3881-L3908
    assert(config.tokenizer_class === "BertTokenizer");

    return new BertTokenizer(json, config);
}
