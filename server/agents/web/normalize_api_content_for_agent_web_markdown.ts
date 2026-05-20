import {Draft} from "immer";
import {
    normalizeApiContentResponse,
    normalizeDraftApiContentInlineElementsResponse,
    normalizeDraftApiContentResponse,
} from "~/shared/api/markdown/normalize_api_content.js";
import {
    ApiContentInlineElement,
    ApiContentResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";

export function normalizeApiContentForAgentWebMarkdown(
    content: ApiContentResponse,
): ApiContentResponse {
    return normalizeApiContentResponse(content, {
        // Agent web markdown doesn't preserve file gallery `width`s across print and
        // parse. The agent doesn't need to know the visual width of files in a gallery. We
        // also set this in `parseApiContentFromAgentWebMarkdown()`.
        withDummyFileGalleryElementLayout: true,
    });
}

export function normalizeDraftApiContentForAgentWebMarkdown(content: Draft<ApiContentResponse>) {
    normalizeDraftApiContentResponse(content, {
        // Agent web markdown doesn't preserve file gallery `width`s across print and
        // parse. The agent doesn't need to know the visual width of files in a gallery. We
        // also set this in `parseApiContentFromAgentWebMarkdown()`.
        withDummyFileGalleryElementLayout: true,
    });
}

export function normalizeDraftApiContentInlineElementsForAgentWebMarkdown(
    elements: Draft<ReadonlyArray<ApiContentInlineElement>>,
) {
    normalizeDraftApiContentInlineElementsResponse(elements, {
        // Agent web markdown doesn't preserve file gallery `width`s across print and
        // parse. The agent doesn't need to know the visual width of files in a gallery. We
        // also set this in `parseApiContentFromAgentWebMarkdown()`.
        withDummyFileGalleryElementLayout: true,
    });
}
