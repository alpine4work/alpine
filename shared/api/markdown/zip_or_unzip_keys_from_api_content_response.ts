import {Draft, produce} from "immer";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {
    ApiContentBlockElementResponseWithOptionalKeys,
    ApiContentResponseWithOptionalKeys,
    ApiContentResponseWithoutKeys,
} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

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
