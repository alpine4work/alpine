import {expect, test} from "@playwright/test";
import fs from "fs/promises";
import {join as joinPath} from "path";
import sharp from "sharp";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {assert} from "~/shared/helpers/control/assert.js";

const {context, services} = createTestServices();

test("can drop files into document", async ({context: browserContext, page}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {
        title: "Lorem Ipsum",
        body: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur a dolor elit. Suspendisse potenti. Suspendisse non diam eu eros cursus venenatis ut a justo. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer turpis enim, cursus non sapien ut, laoreet pretium nulla. Sed felis magna, maximus in neque fermentum, fermentum semper leo. Vivamus eu lacus rhoncus tellus suscipit vestibulum. Quisque ac aliquam turpis. Curabitur placerat eros eget ante ornare, et pellentesque neque tincidunt.

Nullam aliquam, massa non pharetra vehicula, nisi risus pulvinar ligula, ut auctor purus tortor non diam. Mauris ac posuere urna. Vivamus aliquet sodales diam. Quisque ultrices augue eget leo imperdiet, venenatis condimentum leo molestie. Curabitur pulvinar leo nec neque placerat vulputate. Etiam tristique odio quis egestas imperdiet. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus.

Sed scelerisque ultrices augue, vulputate egestas felis convallis non. Donec feugiat eget mi et pulvinar. Pellentesque tincidunt nisi in maximus porta. Vestibulum leo dolor, sollicitudin nec consequat a, venenatis et diam. Nullam volutpat quam ac ex consectetur, sed auctor magna sodales. Ut posuere sodales sem sit amet lacinia. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Aliquam elementum blandit dolor, quis tincidunt purus vehicula quis. Morbi dapibus nunc sit amet leo euismod tempus non sagittis tortor. Donec placerat dolor enim, et varius urna fermentum vitae. Aenean vel elit felis. Etiam ut mi at libero tempor tempus. Morbi eget est neque. Suspendisse ac nibh mollis, venenatis nisl sed, semper metus. Sed egestas, ligula in rhoncus aliquam, elit felis consectetur magna, ac congue turpis purus nec tellus. In lacinia lacinia dictum.

Vivamus rutrum venenatis purus sed luctus. Nulla tincidunt et libero quis malesuada. Curabitur eleifend rhoncus nibh, vitae ornare neque tempus at. Morbi tortor turpis, condimentum non laoreet ut, finibus non eros. Praesent est ex, placerat ac ante non, viverra pellentesque orci. Sed vel porta orci, eu eleifend dui. Aenean bibendum tellus augue, sed convallis metus consectetur quis. Quisque ac malesuada tellus, nec porttitor velit. Donec vel lacus vestibulum, consequat dolor eu, dapibus sapien.

Ut tempus ipsum nisi, quis cursus tortor auctor id. Maecenas pharetra sagittis est quis convallis. Morbi vestibulum dui ipsum, sed tristique magna blandit quis. Nunc pharetra posuere pulvinar. Donec neque ante, viverra sit amet tristique id, placerat non risus. Pellentesque vestibulum dui nec commodo dictum. Duis sit amet semper massa. Vivamus ullamcorper nisl ut molestie tincidunt.`,
    });

    // Make sure the viewport size never changes since we'll need precise pixel
    // placement when dropping an image.
    await page.setViewportSize({width: 1280, height: 720});

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    const file1Contents = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    )
        // When we wrote the tests we weren't rendering files at half their size. So scale
        // the file back up so everything keeps working.
        .resize(1000, 750)
        .toBuffer();

    const file1DataTransfer = await page.evaluateHandle(hexContents => {
        const contents = new Uint8Array(Math.ceil(hexContents.length / 2));

        for (let i = 0; i < contents.length; i++)
            contents[i] = parseInt(hexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 738,
        clientY: 407,
        dataTransfer: file1DataTransfer,
    });

    await expect(
        page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:944"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!944$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 738,
            clientY: 257,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 738,
            clientY: 164,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:13"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!13$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 738,
            clientY: 577,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:1839"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!1839$)/),
    ).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragleave");

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 738,
        clientY: 257,
        dataTransfer: file1DataTransfer,
    });

    await expect(
        page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(0)).toHaveRole(
        "heading",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(1)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(2)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(3)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(4)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(5)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(6)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 738,
        clientY: 407,
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(0)).toHaveRole(
        "heading",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(1)).toHaveRole(
        "paragraph",
    );
    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("> *").nth(2),
    ).not.toHaveRole("paragraph");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(3)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(4)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(5)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(6)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(7)).toBeHidden();

    const file2Contents = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/wikimedia_france_vs_czech_republic_2013_09_21.avif",
        ),
    )
        // When we wrote the tests we weren't rendering files at half their size. So scale
        // the file back up so everything keeps working.
        .resize(480, 268)
        .toBuffer();

    const file2DataTransfer = await page.evaluateHandle(hexContents => {
        const contents = new Uint8Array(Math.ceil(hexContents.length / 2));

        for (let i = 0; i < contents.length; i++)
            contents[i] = parseInt(hexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([contents], "image.avif", {type: "image/avif"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file2Contents.toString("hex"));

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 738,
        clientY: 257,
        dataTransfer: file2DataTransfer,
    });

    await expect(
        page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 855,
            clientY: 641,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:522"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!522$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 504,
            clientY: 343,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 607,
            clientY: 169,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:13"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!13$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 399,
            clientY: 602,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:520"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!520$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 955,
            clientY: 602,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:521"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!521$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 175,
            clientY: 602,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:520"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!520$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 1068,
            clientY: 602,
            dataTransfer: file2DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:521"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!521$)/),
    ).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(0)).toHaveRole(
        "heading",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(1)).toHaveRole(
        "paragraph",
    );
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/jpeg");
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(3)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(4)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(5)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(6)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(7)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 1068,
        clientY: 602,
        dataTransfer: file2DataTransfer,
    });

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(0)).toHaveRole(
        "heading",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(1)).toHaveRole(
        "paragraph",
    );
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(0),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/jpeg");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(1),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/avif");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/),
    ).toHaveCount(2);
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(3)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(4)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(5)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(6)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(7)).toBeHidden();

    const file3Contents = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/wikimedia_png_transparency_demonstration.png",
        ),
    )
        .resize(672, 504)
        .toBuffer();

    const file3DataTransfer = await page.evaluateHandle(hexContents => {
        const contents = new Uint8Array(Math.ceil(hexContents.length / 2));

        for (let i = 0; i < contents.length; i++)
            contents[i] = parseInt(hexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([contents], "image.png", {type: "image/png"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file3Contents.toString("hex"));

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 742,
        clientY: 335,
        dataTransfer: file3DataTransfer,
    });

    await expect(
        page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 742,
            clientY: 416,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:523"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!523$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 500,
            clientY: 322,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 607,
            clientY: 169,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:13"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!13$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 436,
            clientY: 353,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:520"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!520$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 916,
            clientY: 396,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:522"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!522$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 239,
            clientY: 396,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:520"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!520$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 1095,
            clientY: 396,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:522"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!522$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 622,
            clientY: 396,
            dataTransfer: file3DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileIntoRow:521"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!521$)/),
    ).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(0)).toHaveRole(
        "heading",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(1)).toHaveRole(
        "paragraph",
    );
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(0),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/jpeg");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(1),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/avif");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/),
    ).toHaveCount(2);
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(3)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(4)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(5)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(6)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(7)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 1068,
        clientY: 602,
        dataTransfer: file3DataTransfer,
    });

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(0)).toHaveRole(
        "heading",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(1)).toHaveRole(
        "paragraph",
    );
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(0),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/jpeg");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(1),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/png");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/)
            .nth(2),
    ).toHaveAttribute("data-testid", "ContentFilePreview:image/avif");
    await expect(
        page
            .getByRole("textbox", {name: "Document"})
            .locator("> *")
            .nth(2)
            .getByTestId(/^ContentFilePreview:/),
    ).toHaveCount(3);
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(3)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(4)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(5)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(6)).toHaveRole(
        "paragraph",
    );
    await expect(page.getByRole("textbox", {name: "Document"}).locator("> *").nth(7)).toBeHidden();

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 644,
        clientY: 399,
        dataTransfer: file1DataTransfer,
    });

    await expect(
        page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:524"),
    ).toBeVisible();
    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!524$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 644,
            clientY: 326,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 1030,
            clientY: 418,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:524"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!524$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 607,
            clientY: 169,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:13"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!13$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 330,
            clientY: 321,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 737,
            clientY: 415,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:524"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!524$)/),
    ).toBeHidden();

    await expect(async () => {
        await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragover", {
            clientX: 554,
            clientY: 340,
            dataTransfer: file1DataTransfer,
        });

        await expect(
            page.getByTestId("ContentEditorFileDropTargetIndicator:InsertFileRow:519"),
        ).toBeVisible({timeout: 100});
    }).toPass({timeout: 5000});

    await expect(
        page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:(?!519$)/),
    ).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).dispatchEvent("dragleave");

    await expect(page.getByTestId(/^ContentEditorFileDropTargetIndicator:[^:]+:/)).toBeHidden();
});

test("can drop file into floating comment input", async ({
    context: browserContext,
    page,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);
    await document.type(session, "Hello, ");
    const {range} = await document.type(session, "world");
    await document.type(session, "!");

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await page
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    await page.evaluate(`dev.contentEditor.setTextSelection(${range.from}, ${range.to})`);

    if (!isMobile) {
        // Moving the mouse should open the styling toolbar.
        await page.mouse.move(0, 0);
    }

    await page.getByTestId("ContentEditorPointerToolbar").getByLabel("Comment").click();

    const file1Contents = await fs.readFile(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    );

    const file1DataTransfer = await page.evaluateHandle(file1HexContents => {
        const file1Contents = new Uint8Array(Math.ceil(file1HexContents.length / 2));

        for (let i = 0; i < file1Contents.length; i++)
            file1Contents[i] = parseInt(file1HexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([file1Contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    const commentInput = page.getByTestId("ContentEditorCommentInputFloater");
    const commentInputDropTarget = commentInput.getByTestId("ContentEditorCommentInputDropTarget");
    await expect(commentInputDropTarget).toBeVisible();
    await commentInputDropTarget.scrollIntoViewIfNeeded();
    const commentInputDropTargetBox = await commentInputDropTarget.boundingBox();
    assert(commentInputDropTargetBox);
    const commentInputDropCoords = {
        clientX: Math.round(commentInputDropTargetBox.x + commentInputDropTargetBox.width / 2),
        clientY: Math.round(commentInputDropTargetBox.y + commentInputDropTargetBox.height / 2),
    };

    await expect(page.getByTestId("FocusRing")).toBeHidden();
    await expect(
        page.getByTestId("MessageInput").getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await commentInputDropTarget.dispatchEvent("dragenter", {
        ...commentInputDropCoords,
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("FocusRing")).toBeVisible();
    await expect(commentInput.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await commentInputDropTarget.dispatchEvent("drop", {
        ...commentInputDropCoords,
        dataTransfer: file1DataTransfer,
    });

    await expect(page.getByTestId("FocusRing")).toBeHidden();
    await expect(commentInput.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();
    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByLabel("Save comment").click();

    await expect(
        page
            .getByTestId("ContentEditorCommentInputFloater")
            .getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();

    await page.getByText("world").click();

    await expect(
        page
            .getByTestId("ContentEditorCommentInputFloater")
            .getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeHidden();
    await expect(
        page.getByTestId(/^MessageView:/).getByTestId("ContentFilePreview:image/jpeg"),
    ).toBeVisible();
});

test("can copy/paste a file within the same space", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1);
    await document1.access.grantDefault(session1);
    const document2 = await TestDocument.create(session2);
    await document2.access.grantDefault(session2);

    await browserContext1.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space.id}/documents/${document1.id}`);

    const browserContext2 = await browser.newContext();
    await browserContext2.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space.id}/documents/${document2.id}`);

    const file1Contents = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    )
        // When we wrote the tests we weren't rendering files at half their size. So scale
        // the file back up so everything keeps working.
        .resize(1000, 750)
        .toBuffer();

    const file1DataTransfer = await page1.evaluateHandle(hexContents => {
        const contents = new Uint8Array(Math.ceil(hexContents.length / 2));

        for (let i = 0; i < contents.length; i++)
            contents[i] = parseInt(hexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page1.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeHidden();
    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 640,
        clientY: 360,
        dataTransfer: file1DataTransfer,
    });

    await expect(page1.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeVisible();
    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 640,
        clientY: 360,
        dataTransfer: file1DataTransfer,
    });

    await expect(page1.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeHidden();
    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();

    await page1.getByTestId("ContentFilePreview:image/jpeg").dispatchEvent("contextmenu");
    await page1.getByText("Copy image").click();
    await expect(page1.getByText("Copy image")).toBeHidden();

    const clipboardHtml = await page1.evaluate(async () => {
        const clipboardItem = (await navigator.clipboard.read())[0]!;
        const clipboardHtmlBlob = await clipboardItem.getType("text/html");
        const clipboardHtml = await clipboardHtmlBlob.text();
        return clipboardHtml;
    });

    await expect(page2.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();

    await page2.evaluate(async clipboardHtml => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([clipboardHtml], {type: "text/html"}),
            }),
        ]);
    }, clipboardHtml);

    await page2.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).press("ControlOrMeta+v");

    await expect(page2.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();

    await browserContext2.close();
});

test("can copy/paste a file across spaces", async ({
    browser,
    context: browserContext1,
    page: page1,
}) => {
    const space1 = await TestSpace.create(context);
    const space2 = await TestSpace.create(context);
    const session1 = await space1.createSession();
    const session2 = await space2.createSession();

    const document1 = await TestDocument.create(session1);
    await document1.access.grantDefault(session1);
    const document2 = await TestDocument.create(session2);
    await document2.access.grantDefault(session2);

    await browserContext1.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext1, session1);
    await page1.goto(`/s/${space1.id}/documents/${document1.id}`);

    const browserContext2 = await browser.newContext();
    await browserContext2.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/s/${space2.id}/documents/${document2.id}`);

    const file1Contents = await sharp(
        joinPath(
            runfilesPath,
            "cyberworlds/server/files/processor/test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        ),
    )
        // When we wrote the tests we weren't rendering files at half their size. So scale
        // the file back up so everything keeps working.
        .resize(1000, 750)
        .toBuffer();

    const file1DataTransfer = await page1.evaluateHandle(hexContents => {
        const contents = new Uint8Array(Math.ceil(hexContents.length / 2));

        for (let i = 0; i < contents.length; i++)
            contents[i] = parseInt(hexContents.slice(i * 2, i * 2 + 2), 16);

        const dataTransfer = new DataTransfer();
        const file = new File([contents], "image.jpeg", {type: "image/jpeg"});
        dataTransfer.items.add(file);

        return dataTransfer;
    }, file1Contents.toString("hex"));

    await expect(page1.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeHidden();
    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).dispatchEvent("dragenter", {
        clientX: 640,
        clientY: 360,
        dataTransfer: file1DataTransfer,
    });

    await expect(page1.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeVisible();
    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).dispatchEvent("drop", {
        clientX: 640,
        clientY: 360,
        dataTransfer: file1DataTransfer,
    });

    await expect(page1.getByTestId(/^ContentEditorFileDropTargetIndicator:/)).toBeHidden();
    await expect(page1.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();

    await page1.getByTestId("ContentFilePreview:image/jpeg").dispatchEvent("contextmenu");
    await page1.getByText("Copy image").click();
    await expect(page1.getByText("Copy image")).toBeHidden();

    const clipboardHtml = await page1.evaluate(async () => {
        const clipboardItem = (await navigator.clipboard.read())[0]!;
        const clipboardHtmlBlob = await clipboardItem.getType("text/html");
        const clipboardHtml = await clipboardHtmlBlob.text();
        return clipboardHtml;
    });

    await expect(page2.getByTestId("ContentFilePreview:image/jpeg")).toBeHidden();

    await page2.evaluate(async clipboardHtml => {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([clipboardHtml], {type: "text/html"}),
            }),
        ]);
    }, clipboardHtml);

    await page2.getByRole("textbox", {name: "Document"}).focus();
    await page2.getByRole("textbox", {name: "Document"}).press("ControlOrMeta+v");

    await expect(page2.getByTestId("ContentFilePreview:image/jpeg")).toBeVisible();

    await browserContext2.close();
});
