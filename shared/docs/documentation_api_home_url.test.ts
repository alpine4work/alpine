import {documentationApiHomeUrl} from "~/shared/docs/documentation_api_home_url.js";

test("points to the API docs home", () => {
    expect(documentationApiHomeUrl).toBe("/docs/api");
});
