export enum BlobFactoryMode {
    /** Blurry blobs that fall off the further away they get */
    Blur = 0,
    /** Defined, filled shapes */
    Inside = 1,
    /** Defined shapes, filled outside */
    Outside = 2,
    /** Blurry blobs with no dropoff, filling the whole canvas with colour */
    Fill = 3,
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
     * How should we draw the blobs?
     * @default pickRandom(BlobFactoryMode)
     */
    readonly mode: BlobFactoryMode;
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
};
