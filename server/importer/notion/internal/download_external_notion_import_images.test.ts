import {strToU8} from "fflate";
import {readFile} from "fs/promises";
import {join as joinPath} from "path";
import {downloadExternalNotionImportImages} from "~/server/importer/notion/internal/download_external_notion_import_images.js";
import {TestImporterContextModule} from "~/server/importer/test_helpers/test_importer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

const spaceId = generateId<SpaceId>();
const workspaceId = "test-workspace-id";
const createdTime = Date.now();

// 1x1 transparent PNG (smallest valid PNG)
const testPngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82,
]);

function createMockFetch(options: {
    ok?: boolean;
    contentType?: string;
    contentLength?: number;
    body?: Uint8Array;
}): typeof fetch {
    const {ok = true, contentType = "image/png", contentLength, body = testPngBytes} = options;

    return async () =>
        ({
            ok,
            headers: new Headers([
                ["content-type", contentType],
                ["content-length", String(contentLength ?? body.byteLength)],
            ]),
            arrayBuffer: () => Promise.resolve(body.buffer.slice(0)),
        }) as unknown as Response;
}

function createFailingFetch(): typeof fetch {
    return async () => {
        throw new UnknownError("Network error");
    };
}

async function setupAndRun(markdownFiles: Record<string, string>, fetchFn: typeof fetch) {
    const context = new TestImporterContextModule({
        getLocalUploadPath: () => assertExists(process.env.TEST_TMPDIR),
    });
    const diskKey = `test-${generateId()}`;

    const files: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(markdownFiles)) {
        files[path] = strToU8(content);
    }
    await context.setUnzippedFiles(diskKey, files);

    const diskPathToUnzippedFiles = context.getUnzippedFilesPath(diskKey);

    const result = await downloadExternalNotionImportImages(
        {importerService: context},
        diskPathToUnzippedFiles,
        Object.keys(markdownFiles),
        spaceId,
        workspaceId,
        createdTime,
        fetchFn,
    );

    return {result, diskPathToUnzippedFiles, context};
}

test("downloads external image with [Image](url) pattern and rewrites markdown", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const markdown = `# Test\n\n[Image](https://example.com/photo.png)\n\nSome text`;
    const {result, diskPathToUnzippedFiles} = await setupAndRun(
        {"doc abc123.md": markdown},
        fetchFn,
    );

    expect(result.size).toBe(1);

    const [relativePath, downloaded] = [...result.entries()][0]!;
    expect(relativePath).toMatch(/^_downloaded_[a-f0-9]+\.png$/);
    expect(downloaded.id).toBeDefined();

    // Verify the file was written to disk
    const fileOnDisk = await readFile(joinPath(diskPathToUnzippedFiles, relativePath));
    expect(new Uint8Array(fileOnDisk)).toEqual(testPngBytes);

    // Verify the markdown was rewritten
    const rewrittenContent = await readFile(
        joinPath(diskPathToUnzippedFiles, "doc abc123.md"),
        "utf-8",
    );
    expect(rewrittenContent).toContain("![Image](");
    expect(rewrittenContent).not.toContain("https://example.com/photo.png");
});

test("downloads external image with ![alt](url) pattern", async () => {
    const fetchFn = createMockFetch({contentType: "image/jpeg"});
    const markdown = `# Test\n\n![photo](https://example.com/image.jpg)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(1);
    const [relativePath] = [...result.entries()][0]!;
    expect(relativePath).toMatch(/\.jpg$/);
});

test("skips non-image external links", async () => {
    let fetchCalled = false;
    const fetchFn: typeof fetch = async () => {
        fetchCalled = true;
        return new Response();
    };
    const markdown = `# Test\n\n[Click here](https://example.com/page)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    // fetch should not be called since [Click here] is not an image link
    expect(fetchCalled).toBe(false);
    expect(result.size).toBe(0);
});

test("skips images larger than 1 GB", async () => {
    const fetchFn = createMockFetch({
        contentType: "image/png",
        contentLength: 1024 * 1024 * 1024, // Exactly 1 GB
    });
    const markdown = `# Test\n\n[Image](https://example.com/huge.png)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(0);
});

test("skips when response returns non-image content type", async () => {
    const fetchFn = createMockFetch({contentType: "text/html"});
    const markdown = `# Test\n\n[Image](https://example.com/page.html)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(0);
});

test("skips when fetch fails", async () => {
    const fetchFn = createFailingFetch();
    const markdown = `# Test\n\n[Image](https://example.com/broken.png)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(0);
});

test("skips when response returns not ok", async () => {
    const fetchFn = createMockFetch({ok: false});
    const markdown = `# Test\n\n[Image](https://example.com/missing.png)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(0);
});

test("deduplicates the same URL across multiple markdown files", async () => {
    let fetchCount = 0;
    const fetchFn: typeof fetch = async () => {
        fetchCount++;
        const response = await createMockFetch({contentType: "image/png"})("", {});
        return response;
    };

    const markdown1 = `# Doc 1\n\n[Image](https://example.com/shared.png)`;
    const markdown2 = `# Doc 2\n\n[Image](https://example.com/shared.png)`;

    const {result} = await setupAndRun(
        {"doc1 abc111.md": markdown1, "doc2 abc222.md": markdown2},
        fetchFn,
    );

    // Only one file should be downloaded
    expect(result.size).toBe(1);
    // Single GET for the one unique URL
    expect(fetchCount).toBe(1);
});

test("handles multiple external images in a single file", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const markdown = [
        "# Test",
        "",
        "[Image](https://example.com/first.png)",
        "",
        "[Image](https://example.com/second.png)",
    ].join("\n");

    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(2);
});

test("preserves non-image links unchanged in rewritten markdown", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const markdown = [
        "# Test",
        "",
        "[Google](https://google.com)",
        "",
        "[Image](https://example.com/photo.png)",
    ].join("\n");

    const {result, diskPathToUnzippedFiles} = await setupAndRun(
        {"doc abc123.md": markdown},
        fetchFn,
    );

    expect(result.size).toBe(1);

    const rewritten = await readFile(joinPath(diskPathToUnzippedFiles, "doc abc123.md"), "utf-8");
    expect(rewritten).toContain("[Google](https://google.com)");
    expect(rewritten).not.toContain("https://example.com/photo.png");
});

test("generates deterministic file IDs for the same URL", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const markdown = `# Test\n\n[Image](https://example.com/photo.png)`;

    const {result: result1} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);
    const {result: result2} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    const id1 = [...result1.values()][0]!.id;
    const id2 = [...result2.values()][0]!.id;
    expect(id1).toBe(id2);
});

test("skips all IP-based URLs to prevent SSRF", async () => {
    let fetchCalled = false;
    const fetchFn: typeof fetch = async () => {
        fetchCalled = true;
        return new Response();
    };

    const markdown = [
        "# Test",
        "",
        "[Image](http://localhost:8080/admin/secret.png)",
        "[Image](http://127.0.0.1/internal.png)",
        "[Image](http://10.0.0.1/private.png)",
        "[Image](http://169.254.169.254/latest/meta-data/)",
        "[Image](http://192.168.1.1/router.png)",
        "[Image](http://8.8.8.8/public-ip.png)",
        "[Image](http://[::1]/ipv6-localhost.png)",
    ].join("\n");

    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(0);
    expect(fetchCalled).toBe(false);
});

test("handles URLs with parentheses in the path", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const markdown = `# Test\n\n[Image](https://example.com/image(1).png)`;
    const {result, diskPathToUnzippedFiles} = await setupAndRun(
        {"doc abc123.md": markdown},
        fetchFn,
    );

    expect(result.size).toBe(1);

    const rewritten = await readFile(joinPath(diskPathToUnzippedFiles, "doc abc123.md"), "utf-8");
    expect(rewritten).not.toContain("https://example.com/image(1).png");
});

test("skips URLs that time out", async () => {
    const fetchFn: typeof fetch = async (_url, init) => {
        return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
            });
        });
    };

    const markdown = `# Test\n\n[Image](https://example.com/slow.png)`;
    const {result} = await setupAndRun({"doc abc123.md": markdown}, fetchFn);

    expect(result.size).toBe(0);
}, 60_000);

test("handles markdown files in subdirectories", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const markdown = `# Test\n\n[Image](https://example.com/photo.png)`;

    const {result, diskPathToUnzippedFiles} = await setupAndRun(
        {"TeamA/doc abc123.md": markdown},
        fetchFn,
    );

    expect(result.size).toBe(1);

    // File should be saved in the same directory as the markdown file
    const [relativePath] = [...result.entries()][0]!;
    expect(relativePath).toMatch(/^TeamA\/_downloaded_[a-f0-9]+\.png$/);

    // Verify it exists on disk
    const fileOnDisk = await readFile(joinPath(diskPathToUnzippedFiles, relativePath));
    expect(new Uint8Array(fileOnDisk)).toEqual(testPngBytes);
});

test("same URL referenced from different directories writes to each directory", async () => {
    const fetchFn = createMockFetch({contentType: "image/png"});
    const url = "https://example.com/shared.png";
    const markdown1 = `# Root doc\n\n[Image](${url})`;
    const markdown2 = `# Sub doc\n\n[Image](${url})`;

    const {result, diskPathToUnzippedFiles} = await setupAndRun(
        {"doc abc111.md": markdown1, "subfolder/doc abc222.md": markdown2},
        fetchFn,
    );

    // Both directories should have their own copy
    expect(result.size).toBe(2);

    const paths = [...result.keys()];
    const rootPath = paths.find(p => !p.includes("/"))!;
    const subPath = paths.find(p => p.startsWith("subfolder/"))!;

    expect(rootPath).toMatch(/^_downloaded_[a-f0-9]+\.png$/);
    expect(subPath).toMatch(/^subfolder\/_downloaded_[a-f0-9]+\.png$/);

    // Both files exist on disk
    const rootFile = await readFile(joinPath(diskPathToUnzippedFiles, rootPath));
    expect(new Uint8Array(rootFile)).toEqual(testPngBytes);

    const subFile = await readFile(joinPath(diskPathToUnzippedFiles, subPath));
    expect(new Uint8Array(subFile)).toEqual(testPngBytes);

    // Both markdown files reference just the filename (relative to their directory)
    const rootMd = await readFile(joinPath(diskPathToUnzippedFiles, "doc abc111.md"), "utf-8");
    const subMd = await readFile(
        joinPath(diskPathToUnzippedFiles, "subfolder/doc abc222.md"),
        "utf-8",
    );

    expect(rootMd).not.toContain(url);
    expect(subMd).not.toContain(url);

    // Both use the same filename (no directory prefix in the markdown reference)
    const fileName = rootPath;
    expect(rootMd).toContain(`![Image](${encodeURIComponent(fileName)})`);
    expect(subMd).toContain(`![Image](${encodeURIComponent(fileName)})`);
});
