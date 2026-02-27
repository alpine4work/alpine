import Color from "color";
import {interpolateHcl} from "d3-interpolate";
import {
    formatCssLinearGradient,
    generateEasedGradient,
} from "~/client/web/blobs/helpers/blobs_css_gradient.js";
import {
    getBlobsCanvasScale,
    getBlobsCanvasSize,
} from "~/client/web/blobs/helpers/blobs_settings.js";
import {blobFactoryShaderFragSource} from "~/client/web/blobs/helpers/blobs_shader_frag.js";
import {blobFactoryShaderVertSource} from "~/client/web/blobs/helpers/blobs_shader_vert.js";
import {
    BlobFactory,
    BlobFactoryBlobs,
    BlobFactorySettings,
    BlobsWindowCache,
    HTMLCanvasElementWithBlobSettings,
    blobFactoryModeFromSettings,
} from "~/client/web/blobs/helpers/blobs_types.js";
import {Gl} from "~/client/web/helpers/gl/gl.js";
import {
    GlBufferUsage,
    GlPixelFormat,
    GlPixelType,
    GlShaderType,
    GlTextureInternalFormat,
    GlVertexAttribType,
} from "~/client/web/helpers/gl/gl_types.js";
import {Color as ColorVar, colors} from "~/shared/design/core/colors.js";
import {
    blobsArtGradientClassName,
    greyElevated1ClassName,
    greyElevated2ClassName,
} from "~/shared/design/core/constant_class_names.js";
import {easeInOutSin} from "~/shared/design/core/easing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";
import {invLerp} from "~/shared/helpers/number/inv_lerp.js";

declare global {
    interface Window {
        __blobs: BlobsWindowCache;
    }
}

let actuallyDrawBlobsForIntegrationTestMap: WeakMap<HTMLCanvasElement, () => void> | undefined;

if (typeof window !== "undefined" && !window.__blobs) {
    const factory = new Lazy<BlobFactory>(() => {
        const canvas = document.createElement("canvas");
        if (!canvas.getContext("webgl2")) return {isGlSupported: false, draw: null};
        const displayGl = new Gl(canvas);
        const fragShader = displayGl.createShader(
            GlShaderType.Fragment,
            blobFactoryShaderFragSource,
        );
        const vertShader = displayGl.createShader(GlShaderType.Vertex, blobFactoryShaderVertSource);
        const program = displayGl.createProgram(vertShader, fragShader);

        const size = program.uniformVector2("u_resolution", new Vector2(100, 100));
        const smoothness = program.uniformFloat("u_smoothness", 0);
        const blurSize = program.uniformFloat("u_blurSize", 0);
        const blurSpread = program.uniformFloat("u_blurSpread", 0.1);
        const mode = program.uniformEnum<number>("u_mode", 0);
        const backgroundColor = program.uniformColor(
            "u_backgroundColor",
            new Color(colors["grey-0"]),
        );
        const hueBias = program.uniformFloat("u_hueBias", 0);

        const positionsVao = program.createAndBindVertexArray({
            name: "a_position",
            size: 2,
            type: GlVertexAttribType.Float,
        });

        const texture = displayGl.createTexture(0, {
            internalFormat: GlTextureInternalFormat.Rgba32f,
            pixelType: GlPixelType.Float,
            pixelFormat: GlPixelFormat.Rgba,
        });
        texture.configureForData();
        program.uniformTexture2d("u_blobs", texture);

        return {
            isGlSupported: true,
            draw: (
                sizeValue: Vector2,
                settings: BlobFactorySettings,
                blobs: BlobFactoryBlobs,
            ): HTMLCanvasElement => {
                canvas.width = sizeValue.x;
                canvas.height = sizeValue.y;

                size.value = sizeValue;
                displayGl.setDefaultViewport();
                const positions = [
                    0,
                    0,
                    sizeValue.x,
                    sizeValue.y,
                    0,
                    sizeValue.y,
                    0,
                    0,
                    sizeValue.x,
                    0,
                    sizeValue.x,
                    sizeValue.y,
                ];
                positionsVao.bufferData(new Float32Array(positions), GlBufferUsage.StaticDraw);

                smoothness.value = settings.smoothness;
                blurSize.value = settings.blurSize;
                blurSpread.value = settings.blurSpread;
                mode.value = blobFactoryModeFromSettings(settings);
                hueBias.value = settings.hueBias;
                backgroundColor.value = new Color(colors[settings.backgroundColor]);

                displayGl.clear();

                const {colorLevelInside, colorLevelOutside} = settings;
                texture.update({
                    width: blobs.length * (BlobFactoryBlob.size / 4),
                    height: 1,
                    data: new Float32Array(
                        blobs.flatMap(blob => blob.toArray(colorLevelInside, colorLevelOutside)),
                    ),
                });

                program.use();
                positionsVao.bindVao();
                displayGl.gl.drawArrays(WebGL2RenderingContext.TRIANGLES, 0, 6);

                return canvas;
            },
        };
    });

    window.__blobs = {
        factory: factory,
        timing: [],
    };
}

function willDrawBlobFactoryToCanvas(
    canvas: HTMLCanvasElementWithBlobSettings,
    blobSettings: BlobFactorySettings,
): {ok: false} | {ok: true; factory: BlobFactory; defer: boolean} {
    // First check if we've already drawn this blob
    if (typeof window === "undefined" || isDeepEqual(canvas._blobsDrawn, blobSettings)) {
        return {
            ok: false,
        };
    }

    // Check if drawing is supported
    const factory = window.__blobs.factory.get();
    if (!factory.isGlSupported) {
        return {
            ok: false,
        };
    }

    // Clean up timing entries older than 1 second
    const now = Date.now();
    if (now - (window.__blobs.timing[0] || 0) > 1000) {
        window.__blobs.timing = window.__blobs.timing.filter(timestamp => now - timestamp < 1000);
    }
    window.__blobs.timing.push(now);

    // Set the attribute to mark that we're going to be drawing this blob
    canvas._blobsDrawn = blobSettings;

    return {
        ok: true,
        factory,
        // If we've started drawing a lot of blobs in the last second, we defer the drawing
        // to avoid blocking the main thread for too long. This is a workaround for performance issues
        // when drawing many blobs at once, especially on lower-end devices.
        defer: window.__blobs.timing.length > 2,
    };
}

/*
 * Draws the blobs to the canvas.
 */
export function drawBlobFactoryToCanvas(
    canvas: HTMLCanvasElementWithBlobSettings,
    settings: BlobFactorySettings,
    blobs: BlobFactoryBlobs,
) {
    const willDraw = willDrawBlobFactoryToCanvas(canvas, settings);
    if (!willDraw.ok) {
        return;
    }

    const {factory} = willDraw;
    assert(factory.isGlSupported, "Factory should be GL supported");

    const blobsCanvasScale = getBlobsCanvasScale();
    const blobsCanvasSize = getBlobsCanvasSize();

    // If the canvas itself is scaled down or up, we need to adjust the size of the blobs
    // to match the scale. For example, if the canvas is scaled down by 50%, we don't need
    // to scale the blobs up as high in relation to devicePixelRatio.
    const effectiveScale = blobsCanvasScale * settings.scale;
    const scaledBlobs = blobs.map(
        blob =>
            new BlobFactoryBlob(
                blob.center.scale(effectiveScale),
                blob.radius * effectiveScale,
                blob.themeColor,
                blob.hueOffset,
            ),
    );

    // We need to scale the smoothness based on the canvas scale.
    // This is because it determines how eager blobs are to merge together.
    // If the canvas is scaled at all, we want blobs to join at the same rate.
    const scaledSettings = {
        ...settings,
        smoothness: settings.smoothness * effectiveScale,
    };

    const container = assertExists(canvas.parentElement);
    container.setAttribute(
        "style",
        [
            `height: ${blobsCanvasSize.height}px;`,
            `width: ${blobsCanvasSize.width}px;`,
            `left: calc(50% - (${blobsCanvasSize.width / 2}px));`,
            `transform: scale(${settings.scale});`,
        ].join(" "),
    );

    // We scale the drawn image up, but then scale the canvas down to fit the container.
    // This is to ensure that the blobs are drawn at a high resolution, but the canvas
    // fits within the container at the original desired size.
    const size = new Vector2(blobsCanvasSize.width, blobsCanvasSize.height).scale(effectiveScale);
    canvas.setAttribute("width", size.x.toString());
    canvas.setAttribute("height", size.y.toString());
    canvas.setAttribute("style", [`transform: scale(${1 / effectiveScale});`].join(" "));

    const actuallyDraw = () => {
        // Integration tests are flaky when drawing to the canvas, so we skip this in tests.
        // This would cause a huge delay when the GPU can't handle drawing multiple blobs at once.
        // Often causing the test to timeout.
        if (process.env.NODE_ENV === "production" || !(globalThis as any).__isIntegrationTest) {
            const result = factory.draw(size, scaledSettings, scaledBlobs);
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
        } else {
            actuallyDrawBlobsForIntegrationTestMap ??= new WeakMap();

            actuallyDrawBlobsForIntegrationTestMap.set(canvas, () => {
                const result = factory.draw(size, scaledSettings, scaledBlobs);
                const ctx = canvas.getContext("2d")!;
                ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
            });
        }

        // Create the gradient
        // We create this here (as opposed to statically) to ensure we follow the colorScheme as
        // as soon as possible. If we server side render the gradient, we won't know the colorScheme.
        const gradient = assertExists(
            canvas.parentElement?.getElementsByClassName(blobsArtGradientClassName)?.[0],
        );

        // Find parent with elevation class
        let backgroundColor = colors[settings.backgroundColor];
        let parent = canvas.parentElement;

        const elevated1Color = colors.hasOwnProperty(`${settings.backgroundColor}-elevated-1`)
            ? colors[`${settings.backgroundColor}-elevated-1` as ColorVar]
            : null;
        const elevated2Color = colors.hasOwnProperty(`${settings.backgroundColor}-elevated-2`)
            ? colors[`${settings.backgroundColor}-elevated-2` as ColorVar]
            : null;

        if (elevated1Color || elevated2Color) {
            // We only need to check for elevated colors if they exist in the color map.
            while (parent) {
                if (parent.classList.contains(greyElevated1ClassName) && elevated1Color) {
                    backgroundColor = elevated1Color;
                    break;
                } else if (parent.classList.contains(greyElevated2ClassName) && elevated2Color) {
                    backgroundColor = elevated2Color;
                    break;
                }

                parent = parent.parentElement;
            }
        }

        const gradientBackground = formatCssLinearGradient(
            "to bottom",
            generateEasedGradient(
                new Color(backgroundColor).alpha(0).toString(),
                backgroundColor,
                easeInOutSin,
                10,
            ),
        );

        gradient.setAttribute("style", `background-image: ${gradientBackground};`);
    };

    if (willDraw.defer) {
        setTimeout(actuallyDraw, 0);
    } else {
        actuallyDraw();
    }
}

/**
 * In integration tests we skip drawing blobs because doing so is flaky in CI.
 * However, for `//admin/scenarios/screenshots` we want to draw the blob to the
 * canvas for a screenshot. So we provide this function which you can call in
 * an integration test to draw blobs.
 */
export function actuallyDrawBlobsForIntegrationTest() {
    assert(process.env.NODE_ENV !== "production" && (globalThis as any).__isIntegrationTest);

    for (const element of document.querySelectorAll<HTMLCanvasElement>("canvas[data-blob-id]")) {
        const draw = actuallyDrawBlobsForIntegrationTestMap?.get(element);
        actuallyDrawBlobsForIntegrationTestMap?.delete(element);
        draw?.();
    }
}

export class BlobFactoryBlob {
    static size = 12 as const;

    constructor(
        public center: Vector2,
        public radius: number,
        public themeColor: ThemeColor,
        public hueOffset: number = 0,
    ) {}

    getColor(colorLevel: number): Color {
        const color = getInterpolatedThemeColor(colorLevel, this.themeColor).lch();
        const parts = color.array();
        parts[2] = parts[2]! + this.hueOffset;
        const finalColor = Color.lch(...parts).rgb();
        return finalColor;
    }

    toArray(colorLevelInside: number, colorLevelOutside: number) {
        const insideColor = this.getColor(colorLevelInside);
        const outsideColor = this.getColor(colorLevelOutside);
        return [
            this.center.x,
            this.center.y,
            this.radius,
            0,
            insideColor.red() / 255,
            insideColor.green() / 255,
            insideColor.blue() / 255,
            0,
            outsideColor.red() / 255,
            outsideColor.green() / 255,
            outsideColor.blue() / 255,
            0,
        ];
    }

    toJSON() {
        return {center: this.center, radius: this.radius};
    }
}

export function getInterpolatedThemeColor(n: number, theme: ThemeColor): Color {
    if (n < 10) {
        return Color(colors[`${theme}-10`]);
    } else if (n < 20) {
        return interpolateColors(colors[`${theme}-10`], colors[`${theme}-20`], invLerp(10, 20, n));
    } else if (n < 30) {
        return interpolateColors(colors[`${theme}-20`], colors[`${theme}-30`], invLerp(20, 30, n));
    } else if (n < 40) {
        return interpolateColors(colors[`${theme}-30`], colors[`${theme}-40`], invLerp(30, 40, n));
    } else if (n < 50) {
        return interpolateColors(colors[`${theme}-40`], colors[`${theme}-50`], invLerp(40, 50, n));
    } else if (n < 60) {
        return interpolateColors(colors[`${theme}-50`], colors[`${theme}-60`], invLerp(50, 60, n));
    } else if (n < 70) {
        return interpolateColors(colors[`${theme}-60`], colors[`${theme}-70`], invLerp(60, 70, n));
    } else if (n < 80) {
        return interpolateColors(colors[`${theme}-70`], colors[`${theme}-80`], invLerp(70, 80, n));
    } else if (n < 90) {
        return interpolateColors(colors[`${theme}-80`], colors[`${theme}-90`], invLerp(80, 90, n));
    } else if (n < 100) {
        return interpolateColors(colors[`${theme}-90`], "#000000", invLerp(90, 100, n));
    } else {
        return Color("#000000");
    }
}

function interpolateColors(a: string, b: string, n: number) {
    return Color(interpolateHcl(a, b)(n));
}
