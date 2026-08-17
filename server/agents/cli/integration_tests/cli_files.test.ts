/* eslint-disable cyberworlds/string-quotes */

import {mkdir, readFile, rmdir, stat, utimes, writeFile} from "fs/promises";
import {join as joinPath} from "path";
import {setupCliForTest} from "~/server/agents/cli/integration_tests/setup_cli_for_test.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";

const cli = setupCliForTest();
const fileContent = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82,
]);

test("read file from an agent web path", async () => {
    const document = await TestDocument.create(cli.session, {
        title: "File download",
        body: "Download the attached image.",
        access: "Public",
    });
    const uploadResponseBody = await fetchWithTracer(
        cli.session.context.tracer.getTracer(),
        new URL(`/api/files/${cli.space.id}/upload`, cli.session.context.constants.edgeServiceUrl),
        {
            serviceName: "EdgeService",
            route: "/api/files/:spaceId/upload",
            method: "POST",
            headers: {
                "content-type": "image/png",
                "content-length": String(fileContent.byteLength),
                cookie: `session=${await cli.services
                    .getAppServiceTokenAgent()
                    .privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        cli.session.getTokenPayload(),
                    )}`,
            },
            body: fileContent,
        },
        async response => UploadFileResponseSchema.deserialize(await response.json()),
    );
    if (!uploadResponseBody.ok) throw uploadResponseBody.error;
    const file = await TestFile.get(cli.space, uploadResponseBody.file.id);
    await document.attachFile(cli.session, file);

    expect(await cli.run(`alpine read '${cli.services.getBaseUrl()}/doc/${document.id}'`))
        .toEqual(`\
Found path for URL: \`/document/file-download\`.

Call the \`read\` tool again with that path to see the document’s content.
`);

    expect(await cli.run("alpine read /document/file-download")).toEqual(`\
# File download

Download the attached image.

![](/file/image.png)
`);

    const filesDirectoryPath = joinPath(cli.dataDirectoryPath, "downloaded-files");
    const filePath = joinPath(filesDirectoryPath, "image.png");

    expect(
        await cli.run(
            'ALPINE_FILES_PATH="$ALPINE_DATA_PATH/downloaded-files" alpine read /file/image.png',
        ),
    ).toEqual(`${filePath}\n`);

    const downloadedFile = await readFile(filePath);
    expect(downloadedFile).toHaveLength((await file.get()).contentLength);
    expect(downloadedFile.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
});

test("only download the same file once", async () => {
    const document = await TestDocument.create(cli.session, {
        title: "Cached file download",
        body: "Download the attached image.",
        access: "Public",
    });
    const uploadResponseBody = await fetchWithTracer(
        cli.session.context.tracer.getTracer(),
        new URL(`/api/files/${cli.space.id}/upload`, cli.session.context.constants.edgeServiceUrl),
        {
            serviceName: "EdgeService",
            route: "/api/files/:spaceId/upload",
            method: "POST",
            headers: {
                "content-type": "image/png",
                "content-length": String(fileContent.byteLength),
                cookie: `session=${await cli.services
                    .getAppServiceTokenAgent()
                    .privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        cli.session.getTokenPayload(),
                    )}`,
            },
            body: fileContent,
        },
        async response => UploadFileResponseSchema.deserialize(await response.json()),
    );
    if (!uploadResponseBody.ok) throw uploadResponseBody.error;
    const file = await TestFile.get(cli.space, uploadResponseBody.file.id);
    await document.attachFile(cli.session, file);

    expect(await cli.run(`alpine read '${cli.services.getBaseUrl()}/doc/${document.id}'`))
        .toEqual(`\
Found path for URL: \`/document/cached-file-download\`.

Call the \`read\` tool again with that path to see the document’s content.
`);

    expect(await cli.run("alpine read /document/cached-file-download")).toEqual(`\
# Cached file download

Download the attached image.

![](/file/image.png)
`);

    const filesDirectoryPath = joinPath(cli.dataDirectoryPath, "cached-files");
    const filePath = joinPath(filesDirectoryPath, "image.png");
    const readFileCommand =
        'ALPINE_FILES_PATH="$ALPINE_DATA_PATH/cached-files" alpine read /file/image.png';

    expect(await cli.run(readFileCommand)).toEqual(`${filePath}\n`);

    await utimes(
        filePath,
        new Date("2000-01-01T00:00:00.000Z"),
        new Date("2000-01-01T00:00:00.000Z"),
    );
    const cachedFileModifiedTime = (await stat(filePath)).mtime;

    expect(await cli.run(readFileCommand)).toEqual(`${filePath}\n`);
    expect((await stat(filePath)).mtime).toEqual(cachedFileModifiedTime);
});

test("download the same file again after ALPINE_DATA_PATH is cleared", async () => {
    const document = await TestDocument.create(cli.session, {
        title: "Cache reset file download",
        body: "Download the attached image.",
        access: "Public",
    });
    const uploadResponseBody = await fetchWithTracer(
        cli.session.context.tracer.getTracer(),
        new URL(`/api/files/${cli.space.id}/upload`, cli.session.context.constants.edgeServiceUrl),
        {
            serviceName: "EdgeService",
            route: "/api/files/:spaceId/upload",
            method: "POST",
            headers: {
                "content-type": "image/png",
                "content-length": String(fileContent.byteLength),
                cookie: `session=${await cli.services
                    .getAppServiceTokenAgent()
                    .privateSide.dangerouslySignShortLivedToken(
                        "EdgeService",
                        cli.session.getTokenPayload(),
                    )}`,
            },
            body: fileContent,
        },
        async response => UploadFileResponseSchema.deserialize(await response.json()),
    );
    if (!uploadResponseBody.ok) throw uploadResponseBody.error;
    const file = await TestFile.get(cli.space, uploadResponseBody.file.id);
    await document.attachFile(cli.session, file);

    expect(await cli.run(`alpine read '${cli.services.getBaseUrl()}/doc/${document.id}'`))
        .toEqual(`\
Found path for URL: \`/document/cache-reset-file-download\`.

Call the \`read\` tool again with that path to see the document’s content.
`);

    expect(await cli.run("alpine read /document/cache-reset-file-download")).toEqual(`\
# Cache reset file download

Download the attached image.

![](/file/image.png)
`);

    const filesDirectoryPath = `${cli.dataDirectoryPath}-files`;
    const filePath = joinPath(filesDirectoryPath, "image.png");
    const readFileCommand =
        'ALPINE_FILES_PATH="$ALPINE_DATA_PATH-files" alpine read /file/image.png';

    expect(await cli.run(readFileCommand)).toEqual(`${filePath}\n`);

    const initiallyDownloadedFile = await readFile(filePath);
    const authJson = await readFile(joinPath(cli.dataDirectoryPath, "auth.json"), "utf8");
    await utimes(
        filePath,
        new Date("2000-01-01T00:00:00.000Z"),
        new Date("2000-01-01T00:00:00.000Z"),
    );
    const initialFileModifiedTime = (await stat(filePath)).mtime;

    await rmdir(cli.dataDirectoryPath, {recursive: true});
    await mkdir(cli.dataDirectoryPath, {recursive: true});

    // Restore only the login credential the CLI needs. The agent web path and file
    // download caches remain cleared, so reacquire the document and file paths below.
    await writeFile(joinPath(cli.dataDirectoryPath, "auth.json"), authJson);

    expect(await cli.run(`alpine read '${cli.services.getBaseUrl()}/doc/${document.id}'`))
        .toEqual(`\
Found path for URL: \`/document/cache-reset-file-download\`.

Call the \`read\` tool again with that path to see the document’s content.
`);

    expect(await cli.run("alpine read /document/cache-reset-file-download")).toEqual(`\
# Cache reset file download

Download the attached image.

![](/file/image.png)
`);

    expect(await cli.run(readFileCommand)).toEqual(`${filePath}\n`);
    expect(await readFile(filePath)).toEqual(initiallyDownloadedFile);
    expect((await stat(filePath)).mtime.getTime()).toBeGreaterThan(
        initialFileModifiedTime.getTime(),
    );
});
