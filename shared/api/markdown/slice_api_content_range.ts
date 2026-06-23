import {ApiContentRange} from "~/shared/api/specification/types/api_content_position.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {UnimplementedError} from "~/shared/error/error.js";

export function sliceApiContentRange(
    content: ApiContentResponse,
    range: ApiContentRange,
): ApiContentResponse {
    throw new UnimplementedError("NOCOMMIT");
}
