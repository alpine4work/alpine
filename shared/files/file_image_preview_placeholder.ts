import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {createSchemaLazyTransformClass} from "~/shared/schema/helpers/create_schema_lazy_transform_class.js";
import {JsonStringifiableUint8Array, Schema} from "~/shared/schema/schema.open_source.js";

/**
 * A placeholder of base size 5 generates at most 60 pixels (if width is 5, then
 * max height is `round(5 / minFilePreviewAspectRatio)` which equals 12 as of
 * 2024-10-04).
 *
 * A pixel is 3 or 4 bytes depending on whether there's an alpha channel. So the
 * max number of bytes in a placeholder is 240 bytes.
 */
export const fileImagePreviewPlaceholderBaseSize = 5;

/**
 * File preview placeholder blur image.
 *
 * When displaying a file preview it might take a second for us to download the
 * preview image from the network. We'll always have available a file preview
 * placeholder to display while the real image is loading. The placeholder is a
 * blurred image derived from the actual preview image. This image loading
 * technique is described in "[Inline Image Previews with Sharp, BlurHash, and
 * Lambda Functions][1]" (though our implementation doesn't use BlurHash). Our
 * implementation is derived from [`plaiceholder`][2].
 *
 * When stored in the database and serialized over the network the placeholder is
 * represented by a dense array of bytes. These bytes are a flattened pixel grid.
 * This grid is rendered on the client using `linear-gradient()`s in CSS to create
 * the blur effect. It's more efficient to store the raw pixel data instead of the
 * `linear-gradient()` strings.
 *
 * [1]:
 *     https://css-tricks.com/inline-image-previews-with-sharp-blurhash-and-lambda-functions
 * [2]: https://plaiceholder.co/docs
 */
export type FileImagePreviewPlaceholder = InstanceType<typeof FileImagePreviewPlaceholder>;

export const FileImagePreviewPlaceholder = createSchemaLazyTransformClass<
    readonly [hasAlphaChannel: boolean, width: number, data: Uint8Array],
    NonEmptyReadonlyArray<
        NonEmptyReadonlyArray<{
            readonly r: number;
            readonly g: number;
            readonly b: number;
            readonly alpha?: number;
        }>
    >
>(Schema.tuple([Schema.boolean, Schema.integer, Schema.bytes]), {
    serialize: pixelGrid => {
        const hasAlphaChannel = pixelGrid[0][0].alpha !== undefined;
        const width = pixelGrid[0].length;
        const channelCount = hasAlphaChannel ? 4 : 3;

        const data = new JsonStringifiableUint8Array(width * pixelGrid.length * channelCount);

        for (let y = 0; y < pixelGrid.length; y++) {
            const pixelRow = pixelGrid[y]!;
            assert(pixelRow.length === width);

            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * channelCount;
                const pixel = pixelRow[x]!;

                data[i] = pixel.r;
                data[i + 1] = pixel.g;
                data[i + 2] = pixel.b;

                if (!hasAlphaChannel) {
                    assert(pixel.alpha === undefined);
                } else {
                    assert(pixel.alpha !== undefined);
                    data[i + 3] = Math.round(pixel.alpha * 255);
                }
            }
        }

        return [hasAlphaChannel, width, data];
    },
    deserialize: ([hasAlphaChannel, width, data]) => {
        const channelCount = hasAlphaChannel ? 4 : 3;

        const pixelGrid: Array<
            Array<{
                readonly r: number;
                readonly g: number;
                readonly b: number;
                readonly alpha: number | undefined;
            }>
        > = [[]];

        for (let i = 0; i < data.length; i += channelCount) {
            const r = data[i]!;
            const g = data[i + 1]!;
            const b = data[i + 2]!;
            const alpha = hasAlphaChannel ? data[i + 3]! / 255 : undefined;

            const pixel = {r, g, b, alpha};

            let lastPixelRow = pixelGrid[pixelGrid.length - 1]!;

            if (lastPixelRow.length >= width) {
                lastPixelRow = [];
                pixelGrid.push(lastPixelRow);
            }

            lastPixelRow.push(pixel);
        }

        assert(pixelGrid.length > 0);
        assert(pixelGrid[0]!.length > 0);

        return pixelGrid as any;
    },
});
