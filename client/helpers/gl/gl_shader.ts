import {Gl} from "~/client/helpers/gl/gl";
import {GlShaderType, glEnum} from "~/client/helpers/gl/gl_types";
import {assertExists} from "~/shared/helpers/control/assert_exists";

export class GlShader {
    readonly shader: WebGLShader;
    private readonly gl: Gl;

    constructor(_gl: Gl, readonly type: GlShaderType, source: string) {
        this.gl = _gl;
        const {gl} = _gl;
        const shader = assertExists(gl.createShader(glEnum(type)));
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!success) {
            const error = `Failed to compile shader: ${gl.getShaderInfoLog(shader) ?? ""}`;
            gl.deleteShader(shader);
            fail(error);
        }
        this.shader = shader;
    }
}
