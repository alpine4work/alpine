import Color from "color";
import {Gl} from "~/client/web/helpers/gl/gl.js";
import {GlShader} from "~/client/web/helpers/gl/gl_shader.js";
import {GlTexture2d} from "~/client/web/helpers/gl/gl_texture_2d.js";
import {GlVertexAttribType, glEnum} from "~/client/web/helpers/gl/gl_types.js";
import {
    GlUniform,
    GlUniformBool,
    GlUniformColor,
    GlUniformEnum,
    GlUniformFloat,
    GlUniformTexture2d,
    GlUniformVector2,
} from "~/client/web/helpers/gl/gl_uniform.js";
import {GlVertexArray} from "~/client/web/helpers/gl/gl_vertex_array.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";

export class GlProgram {
    readonly program: WebGLProgram;
    private readonly gl: Gl;
    private readonly uniforms: Array<GlUniform<unknown>> = [];

    constructor(
        _gl: Gl,
        readonly vertexShader: GlShader,
        readonly fragmentShader: GlShader,
    ) {
        this.gl = _gl;
        const {gl} = _gl;
        const program = assertExists(gl.createProgram());
        gl.attachShader(program, vertexShader.shader);
        gl.attachShader(program, fragmentShader.shader);
        gl.linkProgram(program);

        const success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (!success) {
            const error = `Failed to link shaders: ${gl.getProgramInfoLog(program) ?? ""}`;
            gl.deleteProgram(program);
            throw new InternalError(error);
        }

        this.program = program;
    }

    createAndBindVertexArray({
        name,
        size,
        type,
        normalize = false,
        stride = 0,
        offset = 0,
    }: {
        name: string;
        size: number;
        type: GlVertexAttribType;
        normalize?: boolean;
        stride?: number;
        offset?: number;
    }): GlVertexArray {
        const {gl} = this.gl;
        const buffer = this.gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

        const vertexArray = this.gl.createVertexArray();
        gl.bindVertexArray(vertexArray);

        const attribLocation = gl.getAttribLocation(this.program, name);
        gl.enableVertexAttribArray(attribLocation);
        gl.vertexAttribPointer(attribLocation, size, glEnum(type), normalize, stride, offset);

        return new GlVertexArray(this.gl, vertexArray, buffer);
    }

    private getUniformLocation(name: string) {
        return assertExists(
            this.gl.gl.getUniformLocation(this.program, name),
            `uniform ${name} does not exist`,
        );
    }

    private addUniform<T, Uniform extends GlUniform<T>>(
        GlUniformType: {
            new (gl: Gl, name: string, location: WebGLUniformLocation, initialValue: T): Uniform;
        },
        name: string,
        initialValue: T,
    ): Uniform {
        const uniform = new GlUniformType(
            this.gl,
            name,
            this.getUniformLocation(name),
            initialValue,
        );
        this.uniforms.push(uniform);
        return uniform;
    }

    uniformVector2(name: string, initialValue: Vector2) {
        return this.addUniform(GlUniformVector2, name, initialValue);
    }

    uniformFloat(name: string, initialValue: number) {
        return this.addUniform(GlUniformFloat, name, initialValue);
    }

    uniformBool(name: string, initialValue: boolean) {
        return this.addUniform(GlUniformBool, name, initialValue);
    }

    uniformTexture2d(name: string, initialValue: GlTexture2d) {
        return this.addUniform(GlUniformTexture2d, name, initialValue);
    }

    uniformEnum<T extends number>(name: string, initialValue: T) {
        return this.addUniform(GlUniformEnum, name, initialValue);
    }

    uniformColor(name: string, initialValue: Color) {
        return this.addUniform(GlUniformColor, name, initialValue);
    }

    use() {
        this.gl.gl.useProgram(this.program);
        for (const uniform of this.uniforms) {
            uniform.apply();
        }
    }
}
