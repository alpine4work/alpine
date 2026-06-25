import {produce} from "immer";
import {ApiContentNormalizer} from "~/shared/api/content/normalize_api_content.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";

export function normalizeApiContentForAgentWebMarkdown(
    content: ApiContentResponseWithoutKeys,
): ApiContentResponseWithoutKeys {
    return produce(content, content => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizer.normalize(content);
        });
    });
}

export function withApiContentNormalizerForAgentWebMarkdown<Value>(
    action: (normalizer: ApiContentNormalizer) => Value,
): Value {
    return ApiContentNormalizer.with(action, {
        // `parseApiContentFromAgentWebMarkdown()` returns `ApiContentResponse` so
        // normalization needs to include response properties.
        isResponse: true,
        // Agent web markdown doesn't preserve file gallery `width`s across print and
        // parse. The agent doesn't need to know the visual width of files in a gallery. We
        // also set this in `parseApiContentFromAgentWebMarkdown()`.
        withDummyFileGalleryElementLayout: true,
    });
}
