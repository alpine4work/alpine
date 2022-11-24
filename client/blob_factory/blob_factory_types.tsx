import {Color} from "~/shared/design/colors";

export const BlobFactoryDrawOutsideFlag = 1;
export const BlobFactoryDrawInsideFlag = 2;
export const BlobFactoryForceOutsideChromaLightnessFlag = 4;

export function blobFactoryModeFromSettings({
    shouldDrawInside,
    shouldDrawOutside,
    shouldForceOutsideChromaLightness,
}: BlobFactorySettings) {
    let mode = 0;
    if (shouldDrawInside) {
        mode |= BlobFactoryDrawInsideFlag;
    }
    if (shouldDrawOutside) {
        mode |= BlobFactoryDrawOutsideFlag;
    }
    if (shouldForceOutsideChromaLightness) {
        mode |= BlobFactoryForceOutsideChromaLightnessFlag;
    }
    return mode;
}

export enum BlobFactoryInterpolateMode {
    /**
     * Take a simple average. Always produces smooth interpolation, but sometimes will
     * take the long way round the colour wheel producing unexpected gradients.
     */
    Naive = 0,
    /**
     * Use normal interpolation for the L and C channels, but take the [circular mean][1]
     * of the hue. Can produce very sharp colour changes when hues are close to polar opposites.
     *
     * [1]: https://en.wikipedia.org/wiki/Circular_mean
     */
    Vector = 1,
    /**
     * Take a simple average, but take the shortest distance round the colour wheel.
     * Produces hard-to-predict discontinuities.
     */
    Min = 2,
}

export type BlobFactorySettings = {
    readonly shouldDrawOutside: boolean;
    readonly shouldDrawInside: boolean;
    readonly shouldForceOutsideChromaLightness: boolean;

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
     * How should colour interpolation work?
     * @default pickRandom(BlobFactoryInterpolateMode)
     */
    readonly interpolateMode: BlobFactoryInterpolateMode;
    /**
     * When using the `Naive` interpolate mode, `hueBias` rotates the entire colour
     * wheel before performing interpolation. If all colours have similar hues, this
     * can be set carefully to make sure that everything takes the "short" way round.
     * @default randomFloat(0, 360)
     */
    readonly hueBias: number;
    /**
     * Which set of colours from our colour scheme shall we use? Levels that aren't
     * precisely defined get interpolated between.
     * @default randomFloat(10, 90)
     */
    readonly colorLevel: number;
    /**
     * Background color of the blobs
     */
    readonly backgroundColor: Color;
    /**
     * Chroma of outside.
     * Only takes effect if shouldForceOutsideChromaLightness is set.
     */
    readonly forcedOutsideChroma: number;
    /**
     * Lightness of outside.
     * Only takes effect if shouldForceOutsideChromaLightness is set.
     */
    readonly forcedOutsideLightness: number;
};
