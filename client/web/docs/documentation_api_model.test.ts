import {
    createDocumentationApiOperationSlug,
    createDocumentationApiOperationUrl,
} from "~/client/web/docs/documentation_api_model.js";

test("builds operation slugs without path parameter braces", () => {
    const slug = createDocumentationApiOperationSlug("GET", "/files/{id}/content");
    expect({slug, url: createDocumentationApiOperationUrl(slug)}).toEqual({
        slug: "get/files/id/content",
        url: "/docs/api/get/files/id/content",
    });
});
