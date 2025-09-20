import decodeIco from "decode-ico";
import fs from "fs/promises";
import looksSame from "looks-same";
import {join as joinPath} from "path";
import sharp from "sharp";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

test("`sharp` dependency can process bmp files", async () => {
    const metadata = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.bmp",
        ),
    ).metadata();

    expect(metadata.format).toEqual("magick");
    expect(metadata.formatMagick).toEqual("BMP");
});

test("`sharp` dependency can process pdf files", async () => {
    const metadata = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/iup_pdf_testpage.pdf",
        ),
    ).metadata();

    expect(metadata.format).toEqual("pdf");
});

test("`looks-same` dependency works", async () => {
    const {equal} = await looksSame(
        ...(await runAllPromises([
            fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.png",
                ),
            ),
            fs.readFile(
                joinPath(
                    runfilesPath,
                    "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.png",
                ),
            ),
        ])),
    );

    if (equal) {
        throw new InternalError(
            "The two images we provided look the same when we expected them to not look the same",
        );
    }
});

test("`decode-ico` dependency can parse ico files with png and with bmp", async () => {
    const result1 = decodeIco(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/stackoverflow_favicon.ico",
            ),
        ),
    );

    expect(
        result1.map(image => ({type: image.type, width: image.width, height: image.height})),
    ).toEqual([
        {type: "bmp", width: 16, height: 16},
        {type: "bmp", width: 32, height: 32},
    ]);

    const result2 = decodeIco(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/stackoverflow_favicon.png.ico",
            ),
        ),
    );

    expect(
        result2.map(image => ({type: image.type, width: image.width, height: image.height})),
    ).toEqual([
        {type: "png", width: 16, height: 16},
        {type: "png", width: 32, height: 32},
    ]);

    const result3 = decodeIco(
        // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
        // fixing for now.
        // @ts-expect-error
        await fs.readFile(
            joinPath(
                runfilesPath,
                "cyberworlds/server/files/processor/test_fixtures/alpine_favicon_old.ico",
            ),
        ),
    );

    expect(
        result3.map(image => ({type: image.type, width: image.width, height: image.height})),
    ).toEqual([
        {type: "bmp", width: 48, height: 48},
        {type: "bmp", width: 32, height: 32},
        {type: "bmp", width: 16, height: 16},
    ]);
});
