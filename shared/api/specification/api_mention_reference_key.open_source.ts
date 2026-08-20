import {
    ApiReferenceKey,
    parseApiReferenceKey,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.open_source.js";
import {ApiMentionReferenceRequest} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

export type ApiMentionReferenceKey = ApiReferenceKey &
    `${ApiMentionReferenceRequest["type"]}:${string}`;

export function printApiMentionReferenceKey(
    key: ApiMentionReferenceRequest,
): ApiMentionReferenceKey {
    return printApiReferenceKey(key) as ApiMentionReferenceKey;
}

export function parseApiMentionReferenceKey(
    key: ApiMentionReferenceKey,
): ApiMentionReferenceRequest {
    return parseApiReferenceKey(key) as ApiMentionReferenceRequest;
}
