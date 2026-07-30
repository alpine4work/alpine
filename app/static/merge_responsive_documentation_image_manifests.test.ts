import {mergeResponsiveDocumentationImageManifests} from "~/app/static/merge_responsive_documentation_image_manifests.js";

const image = {src: "image", srcSet: "image 320w", width: 640, height: 480};

test("merges responsive documentation image manifests in source order", () => {
    expect(
        mergeResponsiveDocumentationImageManifests([
            {imageBySource: {"/docs/z.png": image}},
            {imageBySource: {"/blog/a.png": image}},
        ]),
    ).toEqual({
        imageBySource: {
            "/blog/a.png": image,
            "/docs/z.png": image,
        },
    });
});

test("rejects duplicate responsive documentation image sources", () => {
    expect(() =>
        mergeResponsiveDocumentationImageManifests([
            {imageBySource: {"/blog/a.png": image}},
            {imageBySource: {"/blog/a.png": image}},
        ]),
    ).toThrow("Duplicate responsive documentation image source: /blog/a.png");
});
