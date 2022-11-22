import Color from "color";
import {interpolateHcl} from "d3-interpolate";
import {blobFactoryShaderFragSource} from "~/client/blob_factory/internal/blob_factory_shader_frag";
import {blobFactoryShaderVertSource} from "~/client/blob_factory/internal/blob_factory_shader_vert";
import {ColorScheme} from "~/client/design/color_scheme";
import {Gl} from "~/client/helpers/gl/gl";
import {
    GlBufferUsage,
    GlPixelFormat,
    GlPixelType,
    GlShaderType,
    GlTextureInternalFormat,
    GlVertexAttribType,
} from "~/client/helpers/gl/gl_types";
import {colors} from "~/shared/design/colors";
import {ThemeColor, themeColors} from "~/shared/design/theme_colors";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {randomArrayItem} from "~/shared/helpers/array/random_array_item";
import {Vector2} from "~/shared/helpers/geometry/vector2";
import {invLerp} from "~/shared/helpers/number/inv_lerp";
import {randomFloat} from "~/shared/helpers/number/random_float";
import {randomInteger} from "~/shared/helpers/number/random_integer";

const initialBlobCount = randomInteger(5, 10);

enum BlobFactoryMode {
    Blur = 0,
    Inside = 1,
    Outside = 2,
    Fill = 3,
}

const modes = [
    {label: "blur", value: BlobFactoryMode.Blur},
    {label: "fill", value: BlobFactoryMode.Fill},
    {label: "inside", value: BlobFactoryMode.Inside},
    {label: "outside", value: BlobFactoryMode.Outside},
];

enum BlobFactoryInterpolateMode {
    Naive = 0,
    Vector = 1,
    Min = 2,
}

const interpolateModes = [
    {label: "naive", value: BlobFactoryInterpolateMode.Naive},
    {label: "vector", value: BlobFactoryInterpolateMode.Vector},
    {label: "min", value: BlobFactoryInterpolateMode.Min},
];

export type BlobFactory = {
    setSize(size: Vector2): void;
    destroy(): void;
};

export function drawBlobFactory(
    displayCanvas: HTMLCanvasElement,
    {colorScheme}: {colorScheme: ColorScheme},
): BlobFactory {
    const displayGl = new Gl(displayCanvas);
    const fragShader = displayGl.createShader(GlShaderType.Fragment, blobFactoryShaderFragSource);
    const vertShader = displayGl.createShader(GlShaderType.Vertex, blobFactoryShaderVertSource);
    const program = displayGl.createProgram(vertShader, fragShader);

    const blobs = createArrayWithLength(
        initialBlobCount,
        () =>
            new Blob(
                new Vector2(randomFloat(200, 600), randomFloat(200, 600)),
                randomFloat(30, 100),
                randomArrayItem(themeColors),
            ),
    );

    const size = program.uniformVector2("u_resolution", new Vector2(100, 100));
    program.uniformFloat("u_smoothness", randomFloat(50, 100));
    program.uniformFloat("u_blurSize", 150);
    program.uniformFloat("u_blurSpread", 0.8);
    program.uniformEnum("u_mode", randomArrayItem(modes).value);
    const darkMode = program.uniformBool("u_darkMode", colorScheme === "dark");
    program.uniformEnum("u_interpolateMode", randomArrayItem(interpolateModes).value);
    program.uniformFloat("u_hueBias", randomFloat(0, 360));
    const colorLevel = darkMode.value ? randomFloat(50, 95) : randomFloat(5, 50);

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

    const setSize = (newSize: Vector2) => {
        size.value = newSize;
        displayGl.setDefaultViewport();
        const positions = [
            0,
            0,
            newSize.x,
            newSize.y,
            0,
            newSize.y,
            0,
            0,
            newSize.x,
            0,
            newSize.x,
            newSize.y,
        ];
        positionsVao.bufferData(new Float32Array(positions), GlBufferUsage.StaticDraw);
        draw();
    };

    const draw = () => {
        displayGl.clear();

        texture.update({
            width: blobs.length * 2,
            height: 1,
            data: new Float32Array(blobs.flatMap(blob => blob.toArray(colorLevel))),
        });

        program.use();
        positionsVao.bindVao();
        displayGl.gl.drawArrays(WebGL2RenderingContext.TRIANGLES, 0, 6);
    };

    let isCancelled = false;

    function loop() {
        if (isCancelled) return;
        draw();
        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    const destroy = () => {
        displayGl.destroy();
        isCancelled = true;
    };

    return {
        setSize,
        destroy,
    };
}

class Blob {
    static size = 8 as const;

    constructor(public center: Vector2, public radius: number, public themeColor: ThemeColor) {}

    toArray(colorLevel: number) {
        const color = interpolateScale(colorLevel, this.themeColor);
        return [
            this.center.x,
            this.center.y,
            this.radius,
            0,
            color.red() / 255,
            color.green() / 255,
            color.blue() / 255,
            0,
        ];
    }

    toJSON() {
        return {center: this.center, radius: this.radius};
    }
}

function interpolateScale(n: number, theme: ThemeColor): Color {
    if (n < 5) {
        return Color(colors[`${theme}-5`]);
    } else if (n < 10) {
        return interpolateColors(colors[`${theme}-5`], colors[`${theme}-10`], invLerp(5, 10, n));
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
