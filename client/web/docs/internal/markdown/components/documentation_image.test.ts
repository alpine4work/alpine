import {DocumentationImage} from "~/client/web/docs/internal/markdown/components/documentation_image.js";

test("renders an image with alt text and source", () => {
    expect(DocumentationImage.markdown({alt: "Screenshot", src: "/docs/screenshot.png"})).toBe(
        "![Screenshot](/docs/screenshot.png)",
    );
});

test("renders missing image props as empty alt and source", () => {
    expect(DocumentationImage.markdown({})).toBe("![]()");
});
