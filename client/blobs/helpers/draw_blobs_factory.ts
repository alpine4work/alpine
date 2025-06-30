import Color from "color";
import {interpolateHcl} from "d3-interpolate";
import {
    formatCssLinearGradient,
    generateEasedGradient,
} from "~/client/blobs/helpers/blobs_css_gradient.js";
import {blobFactoryShaderFragSource} from "~/client/blobs/helpers/blobs_shader_frag.js";
import {blobFactoryShaderVertSource} from "~/client/blobs/helpers/blobs_shader_vert.js";
import {
    BlobFactorySettings,
    blobFactoryModeFromSettings,
} from "~/client/blobs/helpers/blobs_types.js";
import {Gl} from "~/client/helpers/gl/gl.js";
import {
    GlBufferUsage,
    GlPixelFormat,
    GlPixelType,
    GlShaderType,
    GlTextureInternalFormat,
    GlVertexAttribType,
} from "~/client/helpers/gl/gl_types.js";
// import from other to avoid importing the entire client styles
import {blobsArtStyles} from "~/client/styles/other/styles_other.js";
import {colors} from "~/shared/design/core/colors.js";
import {easeInOutSin} from "~/shared/design/core/easing.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";
import {invLerp} from "~/shared/helpers/number/inv_lerp.js";

export type BlobFactory = {
    setSize(size: Vector2): void;
    setSettings(settings: Partial<BlobFactorySettings>): void;
    setBlobs(blobs: BlobFactoryBlobs): void;
    destroy(): void;
};

export type BlobFactoryBlobs = ReadonlyArray<BlobFactoryBlob>;

const blobFactory = new Lazy<
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
      }
>(() => {
    const canvas = document.createElement("canvas");
    if (!canvas.getContext("webgl2")) return {isGlSupported: false, draw: null};
    const displayGl = new Gl(canvas);
    const fragShader = displayGl.createShader(GlShaderType.Fragment, blobFactoryShaderFragSource);
    const vertShader = displayGl.createShader(GlShaderType.Vertex, blobFactoryShaderVertSource);
    const program = displayGl.createProgram(vertShader, fragShader);

    const size = program.uniformVector2("u_resolution", new Vector2(100, 100));
    const smoothness = program.uniformFloat("u_smoothness", 0);
    const blurSize = program.uniformFloat("u_blurSize", 0);
    const blurSpread = program.uniformFloat("u_blurSpread", 0.1);
    const mode = program.uniformEnum<number>("u_mode", 0);
    const backgroundColor = program.uniformColor("u_backgroundColor", new Color(colors["grey-0"]));
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
            scale: number,
            settings: BlobFactorySettings,
            blobs: BlobFactoryBlobs,
        ): HTMLCanvasElement => {
            canvas.width = sizeValue.x * scale;
            canvas.height = sizeValue.y * scale;

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

/*
 * Draws the blobs to the canvas.
 */
export function drawBlobFactoryToCanvas(
    canvas: HTMLCanvasElement,
    settings: BlobFactorySettings,
    blobs: BlobFactoryBlobs,
) {
    // First check if we've already drawn this blob
    const blobKey = btoa(JSON.stringify(settings));
    if (canvas.getAttribute("data-drawn") === blobKey) return;

    const drawResult = blobFactory.get();
    if (!drawResult.isGlSupported) return;

    // NOTE(imjoshin): We're not using the devicePixelRatio here yet, there's a rendering bug
    // when using the devicePixelRatio. We'll address that separately.
    const scale = 1; // window.devicePixelRatio;

    const size = new Vector2(canvas.width, canvas.height).div(scale);
    const result = drawResult.draw(size, scale, settings, blobs);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(result, 0, 0, canvas.width, canvas.height);

    // Set the attribute to mark that we've drawn this blob
    canvas.setAttribute("data-drawn", blobKey);

    // Create the gradient
    // We create this here (as opposed to statically) to ensure we follow the colorScheme as
    // as soon as possible. If we server side render the gradient, we won't know the colorScheme.
    const gradient = assertExists(
        canvas.parentElement?.getElementsByClassName(blobsArtStyles.gradientClassName)?.[0],
    );

    const gradientBackground = formatCssLinearGradient(
        "to bottom",
        generateEasedGradient(
            new Color(colors[settings.backgroundColor]).alpha(0).toString(),
            colors[settings.backgroundColor],
            easeInOutSin,
            10,
        ),
    );

    gradient.setAttribute(
        "style",
        `background-image: ${gradientBackground}; width: ${canvas.width}px;`,
    );
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
        return Color.lch(...parts).rgb();
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
