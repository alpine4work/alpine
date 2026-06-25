import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key_encoder.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {UnimplementedError} from "~/shared/error/error.js";

export function addKeysToApiContent(
    encoder: ApiContentKeyEncoder,
    content: ApiContentResponseWithoutKeys,
): ApiContentResponse {
    throw new UnimplementedError("NOCOMMIT");
}
