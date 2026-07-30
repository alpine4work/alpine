import {documentationHomeUrl} from "~/client/web/docs/documentation_home_url.js";

test("points to the docs home", () => {
    expect(documentationHomeUrl).toBe("/docs");
});
