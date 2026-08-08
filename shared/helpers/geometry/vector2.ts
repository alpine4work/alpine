import {clamp} from "~/shared/helpers/number/clamp.open_source.js";
import {lerp} from "~/shared/helpers/number/lerp.open_source.js";

/**
 * A [vector][1] in two dimensions. Vectors are made up of a distance (magnitude)
 * and direction (angle). This class defines a vector as an (x, y) coordinate in
 * cartesian space (where the initial point is (0, 0)) but has getters which allow
 * you to manipulate the vector in polar form.
 *
 * [1]: https://en.wikipedia.org/wiki/Euclidean_vector
 */
export class Vector2 {
    static readonly zero = new Vector2(0, 0);
    static readonly unit = new Vector2(1, 1);
    static readonly x = new Vector2(1, 0);
    static readonly y = new Vector2(0, 1);

    public static fromPolar(angle: number, magnitude: number) {
        return new Vector2(magnitude * Math.cos(angle), magnitude * Math.sin(angle));
    }

    public static average(points: ReadonlyArray<Vector2>): Vector2 {
        const sum = points.reduce((memo, p) => memo.add(p), Vector2.zero);
        return sum.div(points.length);
    }

    public static from({x, y}: {x: number; y: number}): Vector2 {
        return new Vector2(x, y);
    }

    public static fromEvent({clientX, clientY}: {clientX: number; clientY: number}): Vector2 {
        return new Vector2(clientX, clientY);
    }

    public readonly x: number;
    public readonly y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    public getMagnitudeSquared(): number {
        return this.x * this.x + this.y * this.y;
    }

    public get magnitude(): number {
        return Math.sqrt(this.getMagnitudeSquared());
    }

    public get angle(): number {
        return Math.atan2(this.y, this.x);
    }

    public isInPolygon(polygon: ReadonlyArray<Vector2>): boolean {
        // ray-casting algorithm based on
        // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html

        const {x, y} = this;

        let isInside = false;
        for (
            let currentIdx = 0, previousIdx = polygon.length - 1;
            currentIdx < polygon.length;
            previousIdx = currentIdx++
        ) {
            const {x: currentX, y: currentY} = polygon[currentIdx]!;
            const {x: previousX, y: previousY} = polygon[previousIdx]!;
            const doesIntersect =
                currentY > y !== previousY > y &&
                x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;

            if (doesIntersect) {
                isInside = !isInside;
            }
        }

        return isInside;
    }

    public equals(other: Vector2) {
        return this === other || (this.x === other.x && this.y === other.y);
    }

    public distanceTo({x, y}: Vector2): number {
        return Math.hypot(this.x - x, this.y - y);
    }

    public distanceToSquared({x, y}: Vector2): number {
        const dx = this.x - x;
        const dy = this.y - y;
        return dx * dx + dy * dy;
    }

    public angleTo(other: Vector2): number {
        return other.sub(this).angle;
    }

    public angleBetween(other: Vector2): number {
        const angle = Math.atan2(other.y, other.x) - Math.atan2(this.y, this.x);
        return clamp(-Math.PI, angle, Math.PI);
    }

    public dot(other: Vector2): number {
        return this.x * other.x + this.y * other.y;
    }

    public div(scale: number): Vector2 {
        return new Vector2(this.x / scale, this.y / scale);
    }

    public scale(scale: number): Vector2 {
        return new Vector2(this.x * scale, this.y * scale);
    }

    public negate(): Vector2 {
        return this.scale(-1);
    }

    public add({x, y}: Vector2): Vector2 {
        return new Vector2(this.x + x, this.y + y);
    }

    public sub({x, y}: Vector2): Vector2 {
        return new Vector2(this.x - x, this.y - y);
    }

    public floor(): Vector2 {
        return new Vector2(Math.floor(this.x), Math.floor(this.y));
    }

    public ceil(): Vector2 {
        return new Vector2(Math.ceil(this.x), Math.ceil(this.y));
    }

    public round(): Vector2 {
        return new Vector2(Math.round(this.x), Math.round(this.y));
    }

    public withMagnitude(newMagnitude: number): Vector2 {
        return Vector2.fromPolar(this.angle, newMagnitude);
    }

    public normalize(): Vector2 {
        return this.withMagnitude(1);
    }

    public withAngle(newAngle: number): Vector2 {
        return Vector2.fromPolar(newAngle, this.magnitude);
    }

    public rotate(byAngle: number): Vector2 {
        return this.withAngle(this.angle + byAngle);
    }

    public rotateAround(origin: Vector2, byAngle: number): Vector2 {
        const sin = Math.sin(byAngle);
        const cos = Math.cos(byAngle);

        const dx = this.x - origin.x;
        const dy = this.y - origin.y;

        const nx = dx * cos - dy * sin;
        const ny = dx * sin + dy * cos;

        return new Vector2(nx + origin.x, ny + origin.y);
    }

    public lerp(other: Vector2, n: number): Vector2 {
        return new Vector2(lerp(this.x, other.x, n), lerp(this.y, other.y, n));
    }

    public perpendicular(): Vector2 {
        return new Vector2(this.y, -this.x);
    }

    /** Project this point in the direction `direction` by scalar `distance` */
    public project(direction: Vector2, distance: number): Vector2 {
        return direction.scale(distance).add(this);
    }
}
