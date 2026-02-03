/* eslint-disable cyberworlds/string-quotes */

import {Writable as WritableStream} from "stream";
import {
    resetWriteWithStdioPrefixForTest,
    transformChunkForTest as transformChunk,
    writeWithStdioPrefixForTest as writeWithStdioPrefix,
} from "~/admin/dev/stdio_coordinator.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";

beforeEach(() => {
    resetWriteWithStdioPrefixForTest();
});

test("parses and prints a simple chunk without a newline", () => {
    const chunkLines = transformChunk(Buffer.from("test"));

    expect(chunkLines).toEqual([
        {
            chunks: [Buffer.from("test")],
            activeCodes: [],
        },
    ]);

    let string = "";

    const stream = new WritableStream();

    stream._write = (chunk, encoding, next) => {
        string += chunk.toString("utf8");
        next();
    };

    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(JSON.stringify("test"));

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(JSON.stringify("\u001b[2m[app]\u001b[22m test"));

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify("testtest\n\u001b[2m[app]\u001b[22m test\ntest"),
    );

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify("\u001b[2m[app]\u001b[22m testtest\ntest\n\u001b[2m[app]\u001b[22m test"),
    );
});

test("parses and prints a simple chunk with a newline", () => {
    const chunkLines = transformChunk(Buffer.from("test\n"));

    expect(chunkLines).toEqual([
        {
            chunks: [Buffer.from("test\n")],
            activeCodes: [],
        },
        {
            chunks: [],
            activeCodes: [],
        },
    ]);

    let string = "";

    const stream = new WritableStream();

    stream._write = (chunk, encoding, next) => {
        string += chunk.toString("utf8");
        next();
    };

    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(JSON.stringify("test\n"));

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(JSON.stringify("\u001b[2m[app]\u001b[22m test\n"));

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify("test\ntest\n\u001b[2m[app]\u001b[22m test\ntest\n"),
    );

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(
            "\u001b[2m[app]\u001b[22m test\n\u001b[2m[app]\u001b[22m test\ntest\n\u001b[2m[app]\u001b[22m test\n",
        ),
    );
});

test("parses and prints a simple chunk with a newline and more content", () => {
    const chunkLines = transformChunk(Buffer.from("test1\ntest2"));

    expect(chunkLines).toEqual([
        {
            chunks: [Buffer.from("test1\n")],
            activeCodes: [],
        },
        {
            chunks: [Buffer.from("test2")],
            activeCodes: [],
        },
    ]);

    let string = "";

    const stream = new WritableStream();

    stream._write = (chunk, encoding, next) => {
        string += chunk.toString("utf8");
        next();
    };

    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(JSON.stringify("test1\ntest2"));

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify("\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2"),
    );

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(
            "test1\ntest2test1\ntest2\n\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2\ntest1\ntest2",
        ),
    );

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(
            "\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2test1\n\u001b[2m[app]\u001b[22m test2\ntest1\ntest2\n\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2",
        ),
    );
});

test("parses and prints a simple chunk with two lines", () => {
    const chunkLines = transformChunk(Buffer.from("test1\ntest2\n"));

    expect(chunkLines).toEqual([
        {
            chunks: [Buffer.from("test1\n")],
            activeCodes: [],
        },
        {
            chunks: [Buffer.from("test2\n")],
            activeCodes: [],
        },
        {
            chunks: [],
            activeCodes: [],
        },
    ]);

    let string = "";

    const stream = new WritableStream();

    stream._write = (chunk, encoding, next) => {
        string += chunk.toString("utf8");
        next();
    };

    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(JSON.stringify("test1\ntest2\n"));

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify("\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2\n"),
    );

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(
            "test1\ntest2\ntest1\ntest2\n\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2\ntest1\ntest2\n",
        ),
    );

    string = "";
    resetWriteWithStdioPrefixForTest();

    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, "app");
    writeWithStdioPrefix(stream, chunkLines, null);
    writeWithStdioPrefix(stream, chunkLines, "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(
            "\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2\n\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2\ntest1\ntest2\n\u001b[2m[app]\u001b[22m test1\n\u001b[2m[app]\u001b[22m test2\n",
        ),
    );
});

test("parses and prints a chunk which closes styles on a different line", () => {
    const chunkLines = transformChunk(
        Buffer.from(`\
\u001b[2m10:28:46 AM\u001b[22m \u001b[31m\u001b[1m[vite]\u001b[22m\u001b[39m \u001b[31mError when evaluating SSR module /app/entry.server.tsx: failed to import "react/jsx-dev-runtime"
|- Error: Cannot find module 'react/jsx-dev-runtime' imported from '/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/app/entry.server.tsx'
    at nodeImport (file:///private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/node_modules/.aspect_rules_js/vite@5.1.3_-535941187/node_modules/vite/dist/node/chunks/dep-stQc5rCc.js:54727:25)
    at ssrImport (file:///private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/node_modules/.aspect_rules_js/vite@5.1.3_-535941187/node_modules/vite/dist/node/chunks/dep-stQc5rCc.js:54634:30)
    at eval (/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/app/entry.server.tsx:3:50)
    at instantiateModule (file:///private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/node_modules/.aspect_rules_js/vite@5.1.3_-535941187/node_modules/vite/dist/node/chunks/dep-stQc5rCc.js:54696:15)
\u001b[39m
`),
    );

    expect(
        chunkLines.map(chunkLine =>
            chunkLine.activeCodes.map(({code, endCode}) => ({
                code: JSON.stringify(code).slice(1, -1),
                endCode: JSON.stringify(endCode).slice(1, -1),
            })),
        ),
    ).toEqual([
        [
            {code: "\\u001b[2m", endCode: "\\u001b[22m"},
            {code: "\\u001b[22m", endCode: "\\u001b[22m"},
            {code: "\\u001b[31m", endCode: "\\u001b[39m"},
            {code: "\\u001b[1m", endCode: "\\u001b[22m"},
            {code: "\\u001b[22m", endCode: "\\u001b[22m"},
            {code: "\\u001b[39m", endCode: "\\u001b[39m"},
            {code: "\\u001b[31m", endCode: "\\u001b[39m"},
        ],
        ...createArrayWithLength(5, () => []),
        [{code: "\\u001b[39m", endCode: "\\u001b[39m"}],
        ...createArrayWithLength(1, () => []),
    ]);

    let string = "";

    const stream = new WritableStream();

    stream._write = (chunk, encoding, next) => {
        string += chunk.toString("utf8");
        next();
    };

    writeWithStdioPrefix(stream, chunkLines, "app");

    writeWithStdioPrefix(stream, transformChunk(Buffer.from("test1")), null);
    writeWithStdioPrefix(stream, transformChunk(Buffer.from("test2")), "app");

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(`\
\u001b[2m[app]\u001b[22m \u001b[2m10:28:46 AM\u001b[22m \u001b[31m\u001b[1m[vite]\u001b[22m\u001b[39m \u001b[31mError when evaluating SSR module /app/entry.server.tsx: failed to import "react/jsx-dev-runtime"
\u001b[39m\u001b[2m[app]\u001b[22m \u001b[31m|- Error: Cannot find module 'react/jsx-dev-runtime' imported from '/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/app/entry.server.tsx'
\u001b[39m\u001b[2m[app]\u001b[22m \u001b[31m    at nodeImport (file:///private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/node_modules/.aspect_rules_js/vite@5.1.3_-535941187/node_modules/vite/dist/node/chunks/dep-stQc5rCc.js:54727:25)
\u001b[39m\u001b[2m[app]\u001b[22m \u001b[31m    at ssrImport (file:///private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/node_modules/.aspect_rules_js/vite@5.1.3_-535941187/node_modules/vite/dist/node/chunks/dep-stQc5rCc.js:54634:30)
\u001b[39m\u001b[2m[app]\u001b[22m \u001b[31m    at eval (/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/app/entry.server.tsx:3:50)
\u001b[39m\u001b[2m[app]\u001b[22m \u001b[31m    at instantiateModule (file:///private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/node_modules/.aspect_rules_js/vite@5.1.3_-535941187/node_modules/vite/dist/node/chunks/dep-stQc5rCc.js:54696:15)
\u001b[39m\u001b[2m[app]\u001b[22m \u001b[31m\u001b[39m
test1
\u001b[2m[app]\u001b[22m test2`),
    );
});

test("parses and prints chunks with proper styling when all ansi codes are balanced", () => {
    const chunkLines1 = transformChunk(
        Buffer.from(`\


\u001b[2m$\u001b[22m bazel build \u001b[1m//app //server/edge //server/tasks/realtime //server/jobs/queue //server/files/upload\u001b[22m
\u001b[32mComputing main repo mapping:\u001b[0m\u0020
\r\u001b[1A\u001b[K\u001b[32mLoading:\u001b[0m\u0020
\r\u001b[1A\u001b[K\u001b[32mLoading:\u001b[0m 0 packages loaded
\r\u001b[1A\u001b[K\u001b[32mAnalyzing:\u001b[0m 5 targets (0 packages loaded, 0 targets configured)
\r\u001b[1A\u001b[K\u001b[32mAnalyzing:\u001b[0m 5 targets (0 packages loaded, 0 targets configured)
\u001b[32m[0 / 1]\u001b[0m [Prepa] BazelWorkspaceStatusAction stable-status.txt
\r\u001b[1A\u001b[K\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mAnalyzed 5 targets (1 packages loaded, 885 targets configured).
\u001b[32m[7,188 / 7,218]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mFound 5 targets...
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/edge:edge up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/edge/edge.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/jobs/queue:queue up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/jobs/queue/queue.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/tasks/realtime:realtime up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/tasks/realtime/realtime.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //app:app up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/app/app_development.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/files/upload:upload up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/files/upload/upload.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mElapsed time: 0.560s, Critical Path: 0.10s
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0m1 process: 1 internal.
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mBuild completed successfully, 1 total action

`),
    );

    const chunkLines2Edg = transformChunk(
        Buffer.from(`\
Debugger listening on ws://127.0.0.1:3001/f4deada8-6197-4121-8f27-d95e01bd9752
For help, see: https://nodejs.org/en/docs/inspector
(node:21248) ExperimentalWarning: The Ed25519 Web Crypto API algorithm is an experimental feature and might change at any time
(Use \`node --trace-warnings ...\` to show where the warning was created)
`),
    );

    const chunkLines3Fup = transformChunk(
        Buffer.from(`\
Debugger listening on ws://127.0.0.1:3041/7fe37b12-b7c0-45a9-9488-cf4dc53b6b84
For help, see: https://nodejs.org/en/docs/inspector
`),
    );

    const chunkLines4Edg = transformChunk(
        Buffer.from(`\
(node:21248) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
`),
    );

    const chunkLines5Tsk = transformChunk(
        Buffer.from(`\
Debugger listening on ws://127.0.0.1:3021/5bb1ffdc-776e-411d-8925-03c71f35d3f7
For help, see: https://nodejs.org/en/docs/inspector
`),
    );

    const chunkLines6 = transformChunk(
        Buffer.from(`\
Uncaught exception from dev process manager: Error: spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh ENOENT
\u001b[90m    at ChildProcess._handle.onexit (node:internal/child_process:286:19)\u001b[39m
\u001b[90m    at onErrorNT (node:internal/child_process:484:16)\u001b[39m
\u001b[90m    at process.processTicksAndRejections (node:internal/process/task_queues:82:21)\u001b[39m {
  errno: \u001b[33m-2\u001b[39m,
  code: \u001b[32m'ENOENT'\u001b[39m,
  syscall: \u001b[32m'spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  path: \u001b[32m'/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  spawnargs: [
    \u001b[32m'--port=65336'\u001b[39m,
    \u001b[32m'--viteDev'\u001b[39m,
    \u001b[32m'--viteCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/vite'\u001b[39m,
    \u001b[32m'--bazelDevServerPort=3500'\u001b[39m,
    \u001b[32m'--edgeServiceUrl=http://localhost:3000'\u001b[39m,
    \u001b[32m'--appServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa.pub'\u001b[39m,
    \u001b[32m'--edgeServiceFamilyPublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/edge_service_family_rsa.pub'\u001b[39m,
    \u001b[32m'--taskRealtimeServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/task_realtime_service_rsa.pub'\u001b[39m,
    \u001b[32m'--jobQueueServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/job_queue_service_rsa.pub'\u001b[39m,
    \u001b[32m'--servicePrivateKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa'\u001b[39m,
    \u001b[32m'--ensureLocalCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/ensure'\u001b[39m,
    \u001b[32m'--shouldSeedDynamo'\u001b[39m,
    \u001b[32m'--dynamoLocalPort=3510'\u001b[39m,
    \u001b[32m'--opensearchLocalPort=3520'\u001b[39m,
    \u001b[32m'--jobQueueUrl=http://localhost:3530/local/JobQueue'\u001b[39m,
    \u001b[32m'--taskRealtimeServiceLocalPort=3020'\u001b[39m,
    \u001b[32m'--allMiniLmL6V2LanguageModel=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/all_mini_lm_l6_v2'\u001b[39m,
    \u001b[32m'--inspectorPort=3011'\u001b[39m,
    \u001b[32m'--apnsCertificate=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate.pem'\u001b[39m,
    \u001b[32m'--apnsCertificatePrivateKey=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem'\u001b[39m,
    \u001b[32m'--honeycombApiKey=vqNpLOxOIjYTdAxugeT33D'\u001b[39m
  ]
}
`),
    );

    const chunkLines7Job = transformChunk(
        Buffer.from(`\
Debugger listening on ws://127.0.0.1:3031/05fe86b4-80c6-4dd5-b25e-ad06558d7ee8
For help, see: https://nodejs.org/en/docs/inspector
`),
    );

    const chunkLines8 = transformChunk(
        Buffer.from(`\
Uncaught exception from dev process manager: Error: spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh ENOENT
\u001b[90m    at ChildProcess._handle.onexit (node:internal/child_process:286:19)\u001b[39m
\u001b[90m    at onErrorNT (node:internal/child_process:484:16)\u001b[39m
\u001b[90m    at process.processTicksAndRejections (node:internal/process/task_queues:82:21)\u001b[39m {
  errno: \u001b[33m-2\u001b[39m,
  code: \u001b[32m'ENOENT'\u001b[39m,
  syscall: \u001b[32m'spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  path: \u001b[32m'/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  spawnargs: [
    \u001b[32m'--port=65336'\u001b[39m,
    \u001b[32m'--viteDev'\u001b[39m,
    \u001b[32m'--viteCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/vite'\u001b[39m,
    \u001b[32m'--bazelDevServerPort=3500'\u001b[39m,
    \u001b[32m'--edgeServiceUrl=http://localhost:3000'\u001b[39m,
    \u001b[32m'--appServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa.pub'\u001b[39m,
    \u001b[32m'--edgeServiceFamilyPublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/edge_service_family_rsa.pub'\u001b[39m,
    \u001b[32m'--taskRealtimeServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/task_realtime_service_rsa.pub'\u001b[39m,
    \u001b[32m'--jobQueueServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/job_queue_service_rsa.pub'\u001b[39m,
    \u001b[32m'--servicePrivateKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa'\u001b[39m,
    \u001b[32m'--ensureLocalCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/ensure'\u001b[39m,
    \u001b[32m'--shouldSeedDynamo'\u001b[39m,
    \u001b[32m'--dynamoLocalPort=3510'\u001b[39m,
    \u001b[32m'--opensearchLocalPort=3520'\u001b[39m,
    \u001b[32m'--jobQueueUrl=http://localhost:3530/local/JobQueue'\u001b[39m,
    \u001b[32m'--taskRealtimeServiceLocalPort=3020'\u001b[39m,
    \u001b[32m'--allMiniLmL6V2LanguageModel=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/all_mini_lm_l6_v2'\u001b[39m,
    \u001b[32m'--inspectorPort=3011'\u001b[39m,
    \u001b[32m'--apnsCertificate=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate.pem'\u001b[39m,
    \u001b[32m'--apnsCertificatePrivateKey=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem'\u001b[39m,
    \u001b[32m'--honeycombApiKey=vqNpLOxOIjYTdAxugeT33D'\u001b[39m
  ]
}
`),
    );

    let string = "";

    const stream = new WritableStream();

    stream._write = (chunk, encoding, next) => {
        string += chunk.toString("utf8");
        next();
    };

    writeWithStdioPrefix(stream, chunkLines1, null);
    writeWithStdioPrefix(stream, chunkLines2Edg, "edg");
    writeWithStdioPrefix(stream, chunkLines3Fup, "fup");
    writeWithStdioPrefix(stream, chunkLines4Edg, "edg");
    writeWithStdioPrefix(stream, chunkLines5Tsk, "tsk");
    writeWithStdioPrefix(stream, chunkLines6, null);
    writeWithStdioPrefix(stream, chunkLines7Job, "job");
    writeWithStdioPrefix(stream, chunkLines8, null);

    expect(JSON.stringify(string)).toEqual(
        JSON.stringify(`\


\u001b[2m$\u001b[22m bazel build \u001b[1m//app //server/edge //server/tasks/realtime //server/jobs/queue //server/files/upload\u001b[22m
\u001b[32mComputing main repo mapping:\u001b[0m\u0020
\r\u001b[1A\u001b[K\u001b[32mLoading:\u001b[0m\u0020
\r\u001b[1A\u001b[K\u001b[32mLoading:\u001b[0m 0 packages loaded
\r\u001b[1A\u001b[K\u001b[32mAnalyzing:\u001b[0m 5 targets (0 packages loaded, 0 targets configured)
\r\u001b[1A\u001b[K\u001b[32mAnalyzing:\u001b[0m 5 targets (0 packages loaded, 0 targets configured)
\u001b[32m[0 / 1]\u001b[0m [Prepa] BazelWorkspaceStatusAction stable-status.txt
\r\u001b[1A\u001b[K\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mAnalyzed 5 targets (1 packages loaded, 885 targets configured).
\u001b[32m[7,188 / 7,218]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mFound 5 targets...
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/edge:edge up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/edge/edge.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/jobs/queue:queue up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/jobs/queue/queue.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/tasks/realtime:realtime up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/tasks/realtime/realtime.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //app:app up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/app/app_development.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[KTarget //server/files/upload:upload up-to-date:
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K  bazel-bin/server/files/upload/upload.sh
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mElapsed time: 0.560s, Critical Path: 0.10s
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0m1 process: 1 internal.
\u001b[32m[12,331 / 12,331]\u001b[0m checking cached actions
\r\u001b[1A\u001b[K\u001b[32mINFO: \u001b[0mBuild completed successfully, 1 total action

\u001b[2m[edg]\u001b[22m Debugger listening on ws://127.0.0.1:3001/f4deada8-6197-4121-8f27-d95e01bd9752
\u001b[2m[edg]\u001b[22m For help, see: https://nodejs.org/en/docs/inspector
\u001b[2m[edg]\u001b[22m (node:21248) ExperimentalWarning: The Ed25519 Web Crypto API algorithm is an experimental feature and might change at any time
\u001b[2m[edg]\u001b[22m (Use \`node --trace-warnings ...\` to show where the warning was created)
\u001b[2m[fup]\u001b[22m Debugger listening on ws://127.0.0.1:3041/7fe37b12-b7c0-45a9-9488-cf4dc53b6b84
\u001b[2m[fup]\u001b[22m For help, see: https://nodejs.org/en/docs/inspector
\u001b[2m[edg]\u001b[22m (node:21248) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
\u001b[2m[tsk]\u001b[22m Debugger listening on ws://127.0.0.1:3021/5bb1ffdc-776e-411d-8925-03c71f35d3f7
\u001b[2m[tsk]\u001b[22m For help, see: https://nodejs.org/en/docs/inspector
Uncaught exception from dev process manager: Error: spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh ENOENT
\u001b[90m    at ChildProcess._handle.onexit (node:internal/child_process:286:19)\u001b[39m
\u001b[90m    at onErrorNT (node:internal/child_process:484:16)\u001b[39m
\u001b[90m    at process.processTicksAndRejections (node:internal/process/task_queues:82:21)\u001b[39m {
  errno: \u001b[33m-2\u001b[39m,
  code: \u001b[32m'ENOENT'\u001b[39m,
  syscall: \u001b[32m'spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  path: \u001b[32m'/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  spawnargs: [
    \u001b[32m'--port=65336'\u001b[39m,
    \u001b[32m'--viteDev'\u001b[39m,
    \u001b[32m'--viteCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/vite'\u001b[39m,
    \u001b[32m'--bazelDevServerPort=3500'\u001b[39m,
    \u001b[32m'--edgeServiceUrl=http://localhost:3000'\u001b[39m,
    \u001b[32m'--appServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa.pub'\u001b[39m,
    \u001b[32m'--edgeServiceFamilyPublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/edge_service_family_rsa.pub'\u001b[39m,
    \u001b[32m'--taskRealtimeServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/task_realtime_service_rsa.pub'\u001b[39m,
    \u001b[32m'--jobQueueServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/job_queue_service_rsa.pub'\u001b[39m,
    \u001b[32m'--servicePrivateKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa'\u001b[39m,
    \u001b[32m'--ensureLocalCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/ensure'\u001b[39m,
    \u001b[32m'--shouldSeedDynamo'\u001b[39m,
    \u001b[32m'--dynamoLocalPort=3510'\u001b[39m,
    \u001b[32m'--opensearchLocalPort=3520'\u001b[39m,
    \u001b[32m'--jobQueueUrl=http://localhost:3530/local/JobQueue'\u001b[39m,
    \u001b[32m'--taskRealtimeServiceLocalPort=3020'\u001b[39m,
    \u001b[32m'--allMiniLmL6V2LanguageModel=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/all_mini_lm_l6_v2'\u001b[39m,
    \u001b[32m'--inspectorPort=3011'\u001b[39m,
    \u001b[32m'--apnsCertificate=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate.pem'\u001b[39m,
    \u001b[32m'--apnsCertificatePrivateKey=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem'\u001b[39m,
    \u001b[32m'--honeycombApiKey=vqNpLOxOIjYTdAxugeT33D'\u001b[39m
  ]
}
\u001b[2m[job]\u001b[22m Debugger listening on ws://127.0.0.1:3031/05fe86b4-80c6-4dd5-b25e-ad06558d7ee8
\u001b[2m[job]\u001b[22m For help, see: https://nodejs.org/en/docs/inspector
Uncaught exception from dev process manager: Error: spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh ENOENT
\u001b[90m    at ChildProcess._handle.onexit (node:internal/child_process:286:19)\u001b[39m
\u001b[90m    at onErrorNT (node:internal/child_process:484:16)\u001b[39m
\u001b[90m    at process.processTicksAndRejections (node:internal/process/task_queues:82:21)\u001b[39m {
  errno: \u001b[33m-2\u001b[39m,
  code: \u001b[32m'ENOENT'\u001b[39m,
  syscall: \u001b[32m'spawn /private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  path: \u001b[32m'/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/app/app_development.sh'\u001b[39m,
  spawnargs: [
    \u001b[32m'--port=65336'\u001b[39m,
    \u001b[32m'--viteDev'\u001b[39m,
    \u001b[32m'--viteCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/vite'\u001b[39m,
    \u001b[32m'--bazelDevServerPort=3500'\u001b[39m,
    \u001b[32m'--edgeServiceUrl=http://localhost:3000'\u001b[39m,
    \u001b[32m'--appServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa.pub'\u001b[39m,
    \u001b[32m'--edgeServiceFamilyPublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/edge_service_family_rsa.pub'\u001b[39m,
    \u001b[32m'--taskRealtimeServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/task_realtime_service_rsa.pub'\u001b[39m,
    \u001b[32m'--jobQueueServicePublicKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/job_queue_service_rsa.pub'\u001b[39m,
    \u001b[32m'--servicePrivateKey=/Users/calebmer/Library/Preferences/cyberworlds-development/keys/app_service_rsa'\u001b[39m,
    \u001b[32m'--ensureLocalCachePath=/Users/calebmer/Library/Caches/cyberworlds-development/ensure'\u001b[39m,
    \u001b[32m'--shouldSeedDynamo'\u001b[39m,
    \u001b[32m'--dynamoLocalPort=3510'\u001b[39m,
    \u001b[32m'--opensearchLocalPort=3520'\u001b[39m,
    \u001b[32m'--jobQueueUrl=http://localhost:3530/local/JobQueue'\u001b[39m,
    \u001b[32m'--taskRealtimeServiceLocalPort=3020'\u001b[39m,
    \u001b[32m'--allMiniLmL6V2LanguageModel=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/all_mini_lm_l6_v2'\u001b[39m,
    \u001b[32m'--inspectorPort=3011'\u001b[39m,
    \u001b[32m'--apnsCertificate=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate.pem'\u001b[39m,
    \u001b[32m'--apnsCertificatePrivateKey=/private/var/tmp/_bazel_calebmer/bdcb08d3184e81b525008307e7ae9d3a/execroot/cyberworlds/bazel-out/darwin_arm64-fastbuild/bin/admin/dev/dev.sh.runfiles/cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem'\u001b[39m,
    \u001b[32m'--honeycombApiKey=vqNpLOxOIjYTdAxugeT33D'\u001b[39m
  ]
}
`),
    );
});
