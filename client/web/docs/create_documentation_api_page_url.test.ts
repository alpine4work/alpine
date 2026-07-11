import {createDocumentationApiPageUrl} from "~/client/web/docs/create_documentation_api_page_url.js";

test("builds an API docs page URL under the API home", () => {
    expect(createDocumentationApiPageUrl("authentication")).toBe("/docs/api/authentication");
});
