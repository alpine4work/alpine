import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

export type DocumentationImageData = {
    src: string;
    srcSet: string;
    width: number;
    height: number;
};

/** Parse the image generator's manifest into browser-ready image metadata. */
export function parseDocumentationImageDataBySource(
    value: unknown,
): Record<string, DocumentationImageData> {
    assert(isPlainObject(value), "Expected responsive documentation image manifest");
    assert(isPlainObject(value.imageBySource), "Expected documentation images by source");

    const imageBySource: Record<string, DocumentationImageData> = {};
    for (const [source, image] of Object.entries(value.imageBySource)) {
        assert(isPlainObject(image), `Expected documentation image for ${source}`);
        assert(typeof image.src === "string", `Expected documentation image src for ${source}`);
        assert(
            typeof image.srcSet === "string",
            `Expected documentation image srcSet for ${source}`,
        );
        assert(
            typeof image.width === "number" && Number.isInteger(image.width) && image.width > 0,
            `Expected documentation image width for ${source}`,
        );
        assert(
            typeof image.height === "number" && Number.isInteger(image.height) && image.height > 0,
            `Expected documentation image height for ${source}`,
        );
        imageBySource[source] = {
            src: image.src,
            srcSet: image.srcSet,
            width: image.width,
            height: image.height,
        };
    }

    return imageBySource;
}
