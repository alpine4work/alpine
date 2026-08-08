import {GlProgram} from "~/client/web/helpers/gl/gl_program.js";
import {GlShader} from "~/client/web/helpers/gl/gl_shader.js";
import {GlTexture2d} from "~/client/web/helpers/gl/gl_texture_2d.js";
import {GlShaderType, GlTextureFormat} from "~/client/web/helpers/gl/gl_types.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {getOwnProperty} from "~/shared/helpers/object/get_own_property.js";

export class Gl {
    readonly gl: WebGL2RenderingContext;

    private shaders = new GlResources(
        (type: GlShaderType, source: string) => new GlShader(this, type, source),
        shader => this.gl.deleteShader(shader.shader),
    );
    private programs = new GlResources(
        (vertexShader: GlShader, fragmentShader: GlShader) =>
            new GlProgram(this, vertexShader, fragmentShader),
        program => this.gl.deleteProgram(program.program),
    );
    private buffers = new GlResources(
        () => assertExists(this.gl.createBuffer()),
        buffer => this.gl.deleteBuffer(buffer),
    );
    private vertexArrays = new GlResources(
        () => assertExists(this.gl.createVertexArray()),
        vertexArray => this.gl.deleteVertexArray(vertexArray),
    );
    private textures = new GlResources(
        (textureUnit: number, format: GlTextureFormat, level?: number) =>
            new GlTexture2d(this, textureUnit, format, level),
        texture => this.gl.deleteTexture(texture.texture),
    );

    constructor(readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl2");
        assert(gl, "browser does not support webgl2");
        this.gl = gl;
    }

    destroy() {
        this.shaders.destroyAll();
        this.programs.destroyAll();
        this.buffers.destroyAll();
        this.vertexArrays.destroyAll();
        this.textures.destroyAll();
    }

    createShader(type: GlShaderType, source: string): GlShader {
        return this.shaders.create(type, source);
    }
    createProgram(vertexShader: GlShader, fragmentShader: GlShader): GlProgram {
        return this.programs.create(vertexShader, fragmentShader);
    }
    createBuffer() {
        return this.buffers.create();
    }
    createVertexArray() {
        return this.vertexArrays.create();
    }
    createTexture(textureUnit: number, format: GlTextureFormat, level?: number) {
        return this.textures.create(textureUnit, format, level);
    }

    setDefaultViewport() {
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    clear() {
        const {gl} = this;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    enumToString(value: number) {
        const keys = [];
        for (const key in this.gl) {
            if (getOwnProperty(this.gl, key) === value) {
                keys.push(key);
            }
        }
        return keys.length ? keys.join(" | ") : `0x${value.toString(16)}`;
    }
}

class GlResources<T, Args extends Array<unknown>> {
    private resources: Array<T> = [];

    constructor(
        private readonly initializeResource: (...args: Args) => T,
        private readonly deleteResource: (resource: T) => void,
    ) {}

    create(...args: Args): T {
        const resource = this.initializeResource(...args);
        this.resources.push(resource);
        return resource;
    }

    destroyAll() {
        for (const resource of this.resources) {
            this.deleteResource(resource);
        }
        this.resources = [];
    }
}
