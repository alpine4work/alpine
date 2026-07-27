import {Draft, produce} from "immer";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentBlockElementResponseWithOptionalKeys,
    ApiContentResponseWithOptionalKeys,
} from "~/shared/api/specification/types/api_content_response_with_optional_keys.js";
import {
    ApiContentResponse,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Remove `key`s from `ApiContentResponse` and return them in a flat `keys` array.
 * This flat `keys` array can be zipped back into the content via
 * `zipKeysIntoApiContentResponse()`.
 *
 * This is useful for our agent web system since we unzip and print API content to
 * markdown and we store the `keys` array in metadata (which is invisible to the
 * agent). Then when the agent tries to reference content we parse and zip to get
 * the full API content back so we can reference specific parts of the content.
 */
export function unzipKeysFromApiContentResponse(content: ApiContentResponse): {
    content: ApiContentResponseWithoutKeys;
    keys: ReadonlyArray<ApiContentKey>;
} {
    const keys: Array<ApiContentKey> = [];

    const contentWithoutKeys = produce(content, content => {
        const iterator = traverseKeysInApiContentResponse(content);

        let step = iterator.next();

        while (step.done !== true) {
            if (step.value === undefined) {
                throw new InternalError("Missing `ApiContentKey` in `ApiContentResponse`");
            }

            keys.push(step.value);
            step = iterator.next();
        }
    });

    return {
        content: contentWithoutKeys as ApiContentResponseWithoutKeys,
        keys,
    };
}

/**
 * Add `key`s from a previous `unzipKeysFromApiContentResponse()` call back into
 * API content to produce a full `ApiContentResponse`.
 *
 * This is useful for our agent web system since we unzip and print API content to
 * markdown and we store the `keys` array in metadata (which is invisible to the
 * agent). Then when the agent tries to reference content we parse and zip to get
 * the full API content back so we can reference specific parts of the content.
 */
export function zipKeysIntoApiContentResponse({
    content,
    keys,
}: {
    content: ApiContentResponseWithoutKeys;
    keys: ReadonlyArray<ApiContentKey>;
}): ApiContentResponse {
    let keyIndex = 0;

    const contentWithKeys = produce(content, content => {
        const iterator = traverseKeysInApiContentResponse(content);

        let step = iterator.next();

        while (step.done !== true) {
            if (!(keyIndex < keys.length)) {
                throw new InternalError("Missing `ApiContentKey` in keys array");
            }

            const key = keys[keyIndex]!;
            keyIndex++;

            step = iterator.next(key);
        }
    });

    if (keyIndex !== keys.length) {
        throw new InternalError("Unused `ApiContentKey`s in keys array");
    }

    return contentWithKeys as ApiContentResponse;
}

/**
 * Create temporary keys and zip them into API content. These keys will be rejected
 * by the API! However, it's useful if you want to identify positions in the API
 * content before you know the actual keys in the API content. For example, if an
 * agent is trying to create some content and is trying to reference previous
 * content.
 */
export function unsafelyZipTemporaryKeysIntoApiContentResponse(
    content: ApiContentResponseWithoutKeys,
): {
    content: ApiContentResponse;
    temporaryKeys: ReadonlyArray<ApiContentKey>;
} {
    let keyIndex = 0;
    const temporaryKeys: Array<ApiContentKey> = [];

    const contentWithKeys = produce(content, content => {
        const iterator = traverseKeysInApiContentResponse(content);

        let step = iterator.next();

        while (step.done !== true) {
            const key = `temporary-${keyIndex}` as ApiContentKey;
            temporaryKeys.push(key);
            keyIndex++;

            step = iterator.next(key);
        }
    });

    return {
        content: contentWithKeys as ApiContentResponse,
        temporaryKeys,
    };
}

/**
 * `unsafelyZipTemporaryKeysIntoApiContentResponse()` creates keys containing an
 * index of the key in the `temporaryKeys` array. Parse that index back out of the
 * temporary key.
 */
export function parseTemporaryApiContentKey(key: string): number {
    const match = assertExists(/^temporary-(0|[1-9][0-9]*)$/.exec(key));

    const index = parseInt(match[1]!, 10);
    assert(Number.isSafeInteger(index));

    return index;
}

function* traverseKeysInApiContentResponse(
    content: Draft<ApiContentResponseWithOptionalKeys>,
): IterableIterator<ApiContentKey | undefined, undefined, ApiContentKey | undefined> {
    for (const element of content.elements) {
        yield* traverseKeysInApiContentBlockElementResponse(element);
    }
}

function* traverseKeysInApiContentBlockElementResponse(
    element: Draft<ApiContentBlockElementResponseWithOptionalKeys>,
): IterableIterator<ApiContentKey | undefined, undefined, ApiContentKey | undefined> {
    switch (element.type) {
        case "Paragraph": {
            element.key = yield element.key;
            break;
        }
        case "UnorderedList":
        case "OrderedList":
        case "CheckList": {
            for (const item of element.items) {
                for (const childElement of item.elements) {
                    yield* traverseKeysInApiContentBlockElementResponse(childElement);
                }

                if (item.nestedListElements) {
                    for (const nestedListElement of item.nestedListElements) {
                        yield* traverseKeysInApiContentBlockElementResponse(nestedListElement);
                    }
                }
            }
            break;
        }
        case "Quote": {
            for (const childElement of element.elements) {
                yield* traverseKeysInApiContentBlockElementResponse(childElement);
            }
            break;
        }
        case "Heading": {
            element.key = yield element.key;
            break;
        }
        case "Divider": {
            element.key = yield element.key;
            break;
        }
        case "Table": {
            for (const row of element.rows) {
                for (const cell of row.cells) {
                    for (const childElement of cell.elements) {
                        yield* traverseKeysInApiContentBlockElementResponse(childElement);
                    }
                }
            }
            break;
        }
        case "Code": {
            for (const line of element.lines) {
                line.key = yield line.key;
            }
            break;
        }
        case "File":
        case "Preview": {
            element.key = yield element.key;
            break;
        }
        case "FileGallery": {
            for (const row of element.rows) {
                for (const item of row.items) {
                    item.element.key = yield item.element.key;
                }
            }
            break;
        }
        case "FileFloat": {
            element.element.key = yield element.element.key;
            break;
        }
        default:
            throw exhaustive(element);
    }
}
