import {Gl} from "~/client/web/helpers/gl/gl.js";
import {GlShaderType, glEnum} from "~/client/web/helpers/gl/gl_types.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export class GlShader {
    readonly shader: WebGLShader;
    private readonly gl: Gl;

    constructor(
        _gl: Gl,
        readonly type: GlShaderType,
        source: string,
    ) {
        this.gl = _gl;
        const {gl} = _gl;
        const shader = assertExists(gl.createShader(glEnum(type)));
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!success) {
            const error = `Failed to compile shader: ${gl.getShaderInfoLog(shader) ?? ""}`;
            gl.deleteShader(shader);
            throw new InternalError(error);
        }
        this.shader = shader;
    }
}
