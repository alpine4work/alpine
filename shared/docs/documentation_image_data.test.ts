import {parseDocumentationImageDataBySource} from "~/shared/docs/documentation_image_data.js";

test("constructs responsive documentation image values from validated fields", () => {
    expect(
        parseDocumentationImageDataBySource({
            imageBySource: {
                "/blog/image.png": {
                    src: "/blog/image.0123456789abcdef.png",
                    srcSet: "/blog/image.0123456789abcdef.320w.webp 320w",
                    width: 1200,
                    height: 800,
                    ignored: "value",
                },
            },
        }),
    ).toEqual({
        "/blog/image.png": {
            src: "/blog/image.0123456789abcdef.png",
            srcSet: "/blog/image.0123456789abcdef.320w.webp 320w",
            width: 1200,
            height: 800,
        },
    });
});
