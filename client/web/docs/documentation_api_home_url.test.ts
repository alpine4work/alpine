import {documentationApiHomeUrl} from "~/client/web/docs/documentation_api_home_url.js";

test("points to the API docs home", () => {
    expect(documentationApiHomeUrl).toBe("/docs/api");
});
