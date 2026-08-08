import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Similar interface to `URL` (uses `URL` internally, in fact) but for when you
 * only care about the path (not the domain).
 */
export class UrlPath {
    private readonly _url: URL;

    constructor(string: string) {
        this._url = new URL(string, "https://example.com");
    }

    public get hash(): string {
        return this._url.hash;
    }

    public get pathname(): string {
        return this._url.pathname;
    }

    public get search(): string {
        return this._url.search;
    }

    public get searchParams(): URLSearchParams {
        return this._url.searchParams;
    }

    public toString(): string {
        const string = this._url.toString();
        if (string === "https://example.com") return "/";
        assert(string.startsWith("https://example.com/"));
        return string.slice(19);
    }

    public toJSON(): string {
        return this.toString();
    }
}
