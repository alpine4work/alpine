import {
    ApiReferenceKey,
    parseApiReferenceKey,
    printApiReferenceKey,
} from "~/shared/api/specification/api_reference_key.open_source.js";
import {ApiMentionReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";

export type ApiMentionReferenceKey = ApiReferenceKey & `${ApiMentionReference["type"]}:${string}`;

export function printApiMentionReferenceKey(key: ApiMentionReference): ApiMentionReferenceKey {
    return printApiReferenceKey(key) as ApiMentionReferenceKey;
}

export function parseApiMentionReferenceKey(key: ApiMentionReferenceKey): ApiMentionReference {
    return parseApiReferenceKey(key) as ApiMentionReference;
}
