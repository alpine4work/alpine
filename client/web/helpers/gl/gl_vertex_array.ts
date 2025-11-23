import {Gl} from "~/client/web/helpers/gl/gl.js";
import {GlBufferUsage, glEnum} from "~/client/web/helpers/gl/gl_types.js";

export class GlVertexArray {
    constructor(
        private readonly gl: Gl,
        readonly vertexArray: WebGLVertexArrayObject,
        readonly buffer: WebGLBuffer,
    ) {}

    bufferData(data: BufferSource, usage: GlBufferUsage) {
        const {gl} = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, glEnum(usage));
    }

    bindVao() {
        const {gl} = this.gl;
        gl.bindVertexArray(this.vertexArray);
    }
}
