import {ResponsiveDocumentationImage} from "~/app/docs/codegen/images/generate_responsive_documentation_image.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

/**
 * Merge validated per-source responsive image manifests in source URL order.
 */
export function mergeResponsiveDocumentationImageManifests(values: ReadonlyArray<unknown>): {
    imageBySource: Record<string, ResponsiveDocumentationImage>;
} {
    const entries = values
        .map((value, index) => parseResponsiveDocumentationImageManifest(value, index))
        .sort(([source1], [source2]) => source1.localeCompare(source2));
    const imageBySource: Record<string, ResponsiveDocumentationImage> = {};

    for (const [source, image] of entries) {
        assert(
            imageBySource[source] === undefined,
            `Duplicate responsive documentation image source: ${source}`,
        );
        imageBySource[source] = image;
    }

    return {imageBySource};
}

function parseResponsiveDocumentationImageManifest(
    value: unknown,
    index: number,
): [string, ResponsiveDocumentationImage] {
    assert(isPlainObject(value), `Expected responsive documentation image manifest ${index}`);
    assert(
        isPlainObject(value.imageBySource),
        `Expected responsive documentation image entries ${index}`,
    );
    const entries = Object.entries(value.imageBySource);
    assert(entries.length === 1, `Expected one responsive documentation image entry ${index}`);
    const [source, image] = assertExists(entries[0]);
    assert(isPlainObject(image), `Expected responsive documentation image for ${source}`);
    assert(
        typeof image.src === "string",
        `Expected responsive documentation image src for ${source}`,
    );
    assert(
        typeof image.srcSet === "string",
        `Expected responsive documentation image srcSet for ${source}`,
    );
    assert(
        typeof image.width === "number" && Number.isInteger(image.width) && image.width > 0,
        `Expected responsive documentation image width for ${source}`,
    );
    assert(
        typeof image.height === "number" && Number.isInteger(image.height) && image.height > 0,
        `Expected responsive documentation image height for ${source}`,
    );
    return [
        source,
        {
            src: image.src,
            srcSet: image.srcSet,
            width: image.width,
            height: image.height,
        },
    ];
}
