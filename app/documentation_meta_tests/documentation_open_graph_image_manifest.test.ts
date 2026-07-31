import fs from "fs/promises";
import {join} from "path";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

test("generates the blog home as a BlogHome image without an author", async () => {
    const manifestPath = join(
        assertExists(process.env.RUNFILES),
        "cyberworlds/app/docs/codegen/open_graph_images_blog.json",
    );
    const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));

    expect(manifest).toEqual(
        expect.arrayContaining([
            {
                pageUrl: "/blog",
                document: {type: "BlogHome", title: "Alpine Blog"},
            },
        ]),
    );
});
