import {BlobFactoryBlob} from "~/client/blobs/helpers/draw_blobs_factory.js";
import {Color} from "~/shared/design/core/colors.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";

export const BlobFactoryDrawOutsideFlag = 1;
export const BlobFactoryDrawInsideFlag = 2;

export function blobFactoryModeFromSettings({
    shouldDrawInside,
    shouldDrawOutside,
}: BlobFactorySettings) {
    let mode = 0;
    if (shouldDrawInside) {
        mode |= BlobFactoryDrawInsideFlag;
    }
    if (shouldDrawOutside) {
        mode |= BlobFactoryDrawOutsideFlag;
    }
    return mode;
}

export type BlobFactorySettings = {
    readonly shouldDrawOutside: boolean;
    readonly shouldDrawInside: boolean;

    /**
     * How much SDF smoothing should we apply (px)
     * @default randomFloat(50, 100)
     */
    readonly smoothness: number;
    /**
     * How much should we blur colours (px)
     * @default 150
     */
    readonly blurSize: number;
    /**
     * Exponential falloff factor for blur. 1 = no falloff.
     * @default 0.9
     */
    readonly blurSpread: number;
    /**
     * When using the `Naive` interpolate mode, `hueBias` rotates the entire colour
     * wheel before performing interpolation. If all colours have similar hues, this
     * can be set carefully to make sure that everything takes the "short" way round.
     * @default randomFloat(0, 360)
     */
    readonly hueBias: number;
    /**
     * Which set of colours from our colour scheme shall we use for the inside of blobs?
     * Levels that aren't precisely defined get interpolated between.
     * @default randomFloat(10, 90)
     */
    readonly colorLevelInside: number;
    /**
     * Which set of colours from our colour scheme shall we use for the outside of blobs?
     * Levels that aren't precisely defined get interpolated between.
     * @default randomFloat(10, 90)
     */
    readonly colorLevelOutside: number;
    /**
     * Background color of the blobs
     */
    readonly backgroundColor: Color;
};

export type BlobFactoryBlobs = ReadonlyArray<BlobFactoryBlob>;

export type BlobFactory =
    | {
          isGlSupported: false;
          draw: null;
      }
    | {
          isGlSupported: true;
          draw: (
              sizeValue: Vector2,
              scale: number,
              settings: BlobFactorySettings,
              blobs: BlobFactoryBlobs,
          ) => HTMLCanvasElement;
      };

export type BlobsWindowCache = {
    factory: Lazy<BlobFactory>;
    timing: Array<number>;
};

export type HTMLCanvasElementWithBlobSettings = HTMLCanvasElement & {
    _blobSettings?: BlobFactorySettings;
};
