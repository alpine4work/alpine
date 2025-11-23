import Color from "color";
import {Gl} from "~/client/web/helpers/gl/gl.js";
import {GlTexture2d} from "~/client/web/helpers/gl/gl_texture_2d.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";

export abstract class GlUniform<T> {
    value: T;

    constructor(
        readonly gl: Gl,
        readonly name: string,
        readonly location: WebGLUniformLocation,
        initialValue: T,
    ) {
        this.value = initialValue;
    }

    abstract apply(): void;
}

export class GlUniformVector2 extends GlUniform<Vector2> {
    apply() {
        this.gl.gl.uniform2f(this.location, this.value.x, this.value.y);
    }
}

export class GlUniformFloat extends GlUniform<number> {
    apply() {
        this.gl.gl.uniform1f(this.location, this.value);
    }
}

export class GlUniformBool extends GlUniform<boolean> {
    apply() {
        this.gl.gl.uniform1ui(this.location, this.value ? 1 : 0);
    }
}

export class GlUniformTexture2d extends GlUniform<GlTexture2d> {
    apply() {
        this.gl.gl.uniform1i(this.location, this.value.textureUnit);
    }
}

export class GlUniformEnum<T extends number> extends GlUniform<T> {
    apply(): void {
        this.gl.gl.uniform1i(this.location, this.value);
    }
}

export class GlUniformColor<T extends Color> extends GlUniform<T> {
    apply(): void {
        this.gl.gl.uniform4f(
            this.location,
            this.value.red() / 255,
            this.value.green() / 255,
            this.value.blue() / 255,
            this.value.alpha(),
        );
    }
}
