import {Vector2} from "~/shared/helpers/geometry/vector2.js";

/**
 * A [rectangle][1]. In Euclidean plane geometry, a rectangle is a four-sided
 * polygon with four right angles.
 *
 * [1]: https://en.wikipedia.org/wiki/Rectangle
 */
export class Rectangle {
    public static from({
        x,
        y,
        width,
        height,
    }: {
        x: number;
        y: number;
        width: number;
        height: number;
    }): Rectangle {
        return new Rectangle(x, y, width, height);
    }

    public readonly x: number;
    public readonly y: number;
    public readonly width: number;
    public readonly height: number;

    constructor(x: number, y: number, width: number, height: number) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    public get top() {
        return this.y;
    }

    public get bottom() {
        return this.y + this.height;
    }

    public get left() {
        return this.x;
    }

    public get right() {
        return this.x + this.width;
    }

    public center() {
        return new Vector2(this.x + this.width / 2, this.y + this.height / 2);
    }

    public equals(other: Rectangle): boolean {
        return (
            this === other ||
            (this.x === other.x &&
                this.y === other.y &&
                this.width === other.width &&
                this.height === other.height)
        );
    }

    /**
     * Does this rectangle contain the provided rectangle?
     */
    public contains(other: Rectangle): boolean {
        return (
            other.x >= this.x &&
            other.y >= this.y &&
            other.x + other.width <= this.x + this.width &&
            other.y + other.height <= this.y + this.height
        );
    }

    /**
     * Does this rectangle contain the provided point?
     */
    public containsPoint(point: {x: number; y: number}): boolean {
        return (
            this.x <= point.x &&
            point.x <= this.x + this.width &&
            this.y <= point.y &&
            point.y <= this.y + this.height
        );
    }

    /**
     * Does this rectangle intersect with the provided rectangle?
     */
    public intersects(other: Rectangle): boolean {
        return !(
            other.x + other.width <= this.x ||
            other.y + other.height <= this.y ||
            other.x >= this.x + this.width ||
            other.y >= this.y + this.height
        );
    }

    /**
     * Computes the difference of two rectangles. Difference of two rectangles can
     * produce a maximum of four rectangles. If the two rectangles do not intersect a
     * zero-length array is returned.
     */
    public difference(other: Rectangle): Array<Rectangle> {
        if (other.contains(this)) return [];
        if (!this.intersects(other)) return [this];

        const result: Array<Rectangle> = [];

        const topHeight = other.y - this.y;
        if (topHeight > 0) {
            result.push(new Rectangle(this.x, this.y, this.width, topHeight));
        }

        const bottomY = other.y + other.height;
        const bottomHeight = this.height - (bottomY - this.y);
        if (bottomHeight > 0 && bottomY < this.y + this.height) {
            result.push(new Rectangle(this.x, bottomY, this.width, bottomHeight));
        }

        const horizontalTop = other.y > this.y ? other.y : this.y;
        const horizontalBottom = bottomY < this.bottom ? bottomY : this.bottom;
        const horizontalHeight = horizontalBottom - horizontalTop;

        const leftWidth = other.x - this.x;
        if (leftWidth > 0 && horizontalHeight > 0) {
            result.push(new Rectangle(this.x, horizontalTop, leftWidth, horizontalHeight));
        }

        const rightX = other.x + other.width;
        const rightWidth = this.width - (rightX - this.x);
        if (rightWidth > 0) {
            result.push(new Rectangle(rightX, horizontalTop, rightWidth, horizontalHeight));
        }

        return result;
    }
}
