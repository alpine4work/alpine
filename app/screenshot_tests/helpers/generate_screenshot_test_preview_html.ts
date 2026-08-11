/* eslint-disable cyberworlds/string-quotes */

import escapeHtml from "escape-html";
import fs from "fs/promises";
import {join as joinPath, relative as relativePath, sep} from "path";
import * as prettier from "prettier";
import * as htmlPrettierPlugin from "prettier/plugins/html";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {html} from "~/shared/helpers/string/html.js";

type ScreenshotTestPreviewColorScheme = "light" | "dark";

type ScreenshotTestPreviewFile = {
    colorScheme: ScreenshotTestPreviewColorScheme;
    orderKeyHex: string;
    screenshotName: string;
};

type ScreenshotTestPreviewImage = {
    testName: string;
    orderKeyHex: string;
    screenshotName: string;
    lightPath: string;
    darkPath: string;
};

type ScreenshotTestPreviewIndexedImage = ScreenshotTestPreviewImage & {index: number};

type ScreenshotTestPreviewImageBuilder = {
    testName: string;
    orderKeyHex: string;
    screenshotName: string;
    lightPath: string | null;
    darkPath: string | null;
};

export async function generateScreenshotTestPreviewHtml({
    previewDirectoryPath,
    testNames,
}: {
    previewDirectoryPath: string;
    testNames: ReadonlyArray<string>;
}): Promise<string> {
    const images: Array<ScreenshotTestPreviewImage> = [];

    for (const testName of testNames) {
        images.push(
            ...(await loadScreenshotTestPreviewImages({
                previewDirectoryPath,
                testName,
            })),
        );
    }

    const previewHtmlPath = joinPath(previewDirectoryPath, "preview.html");
    await fs.writeFile(previewHtmlPath, await printScreenshotTestPreviewHtml(images), "utf8");
    return previewHtmlPath;
}

async function loadScreenshotTestPreviewImages({
    previewDirectoryPath,
    testName,
}: {
    previewDirectoryPath: string;
    testName: string;
}): Promise<Array<ScreenshotTestPreviewImage>> {
    const screenshotDirectoryPath = joinPath(previewDirectoryPath, testName);
    const fileNames = (await fs.readdir(screenshotDirectoryPath)).sort();
    const imageBuildersByKey = new Map<string, ScreenshotTestPreviewImageBuilder>();

    for (const fileName of fileNames) {
        const parsedFile = parseScreenshotTestPreviewFileName({testName, fileName});
        if (parsedFile === null) continue;

        const imageKey = `${parsedFile.orderKeyHex}-${parsedFile.screenshotName}`;
        let imageBuilder = imageBuildersByKey.get(imageKey);
        if (imageBuilder === undefined) {
            imageBuilder = {
                testName,
                orderKeyHex: parsedFile.orderKeyHex,
                screenshotName: parsedFile.screenshotName,
                lightPath: null,
                darkPath: null,
            };
            imageBuildersByKey.set(imageKey, imageBuilder);
        }

        const imagePath = printScreenshotTestPreviewImagePath(
            relativePath(previewDirectoryPath, joinPath(screenshotDirectoryPath, fileName)),
        );

        switch (parsedFile.colorScheme) {
            case "light": {
                imageBuilder.lightPath = imagePath;
                break;
            }
            case "dark": {
                imageBuilder.darkPath = imagePath;
                break;
            }
        }
    }

    return Array.from(imageBuildersByKey.values(), imageBuilder => ({
        testName: imageBuilder.testName,
        orderKeyHex: imageBuilder.orderKeyHex,
        screenshotName: imageBuilder.screenshotName,
        lightPath: imageBuilder.lightPath ?? imageBuilder.darkPath ?? "",
        darkPath: imageBuilder.darkPath ?? imageBuilder.lightPath ?? "",
    })).sort(compareScreenshotTestPreviewImages);
}

function parseScreenshotTestPreviewFileName({
    testName,
    fileName,
}: {
    testName: string;
    fileName: string;
}): ScreenshotTestPreviewFile | null {
    const fileExtension = ".png";
    const prefix = `${testName}-`;

    if (!fileName.startsWith(prefix)) return null;
    if (!fileName.endsWith(fileExtension)) return null;

    const fileNameParts = fileName.slice(prefix.length, -fileExtension.length);
    const colorScheme = fileNameParts.startsWith("light-")
        ? "light"
        : fileNameParts.startsWith("dark-")
          ? "dark"
          : null;
    if (colorScheme === null) return null;

    const remainingFileNameParts = fileNameParts.slice(colorScheme.length + 1);
    const orderKeySeparatorIndex = remainingFileNameParts.indexOf("-");
    if (orderKeySeparatorIndex === -1) return null;

    return {
        colorScheme,
        orderKeyHex: remainingFileNameParts.slice(0, orderKeySeparatorIndex),
        screenshotName: remainingFileNameParts.slice(orderKeySeparatorIndex + 1),
    };
}

function printScreenshotTestPreviewImagePath(path: string): string {
    return path.split(sep).map(encodeURIComponent).join("/");
}

function compareScreenshotTestPreviewImages(
    a: ScreenshotTestPreviewImage,
    b: ScreenshotTestPreviewImage,
): number {
    return (
        defaultCompareStrings(a.testName, b.testName) ||
        defaultCompareStrings(a.orderKeyHex, b.orderKeyHex) ||
        defaultCompareStrings(a.screenshotName, b.screenshotName)
    );
}

async function printScreenshotTestPreviewHtml(
    images: ReadonlyArray<ScreenshotTestPreviewImage>,
): Promise<string> {
    const indexedImages = images.map((image, index) => ({...image, index}));
    const testNames = Array.from(new Set(indexedImages.map(image => image.testName)));
    const screenshotSectionsHtml = testNames
        .map(testName =>
            printScreenshotTestPreviewSectionHtml({
                testName,
                images: indexedImages.filter(image => image.testName === testName),
            }),
        )
        .join("\n");

    return await prettier.format(
        html`
            <!doctype html>
            <html lang="en" data-color-scheme="light" style="--columns: 3">
                <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                    <title>Screenshot Test Preview</title>
                    <style>
                        :root {
                            color-scheme: light;
                            font-family:
                                Inter,
                                ui-sans-serif,
                                system-ui,
                                -apple-system,
                                BlinkMacSystemFont,
                                "Segoe UI",
                                sans-serif;
                            background: #5f6670;
                            color: #f6f8fb;
                        }

                        * {
                            box-sizing: border-box;
                        }

                        body {
                            margin: 0;
                            background: #5f6670;
                        }

                        body.is-modal-open {
                            overflow: hidden;
                        }

                        button,
                        input {
                            font: inherit;
                            color: inherit;
                            accent-color: #d7dde5;
                        }

                        button {
                            appearance: none;
                        }

                        .page-header {
                            position: sticky;
                            top: 0;
                            z-index: 1;
                            display: flex;
                            flex-wrap: wrap;
                            align-items: center;
                            justify-content: space-between;
                            gap: 16px;
                            padding: 16px 24px;
                            background: #5f6670;
                        }

                        .title {
                            display: grid;
                            gap: 2px;
                        }

                        h1 {
                            margin: 0;
                            font-size: 18px;
                            font-weight: 650;
                        }

                        .summary {
                            margin: 0;
                            color: #d7dde5;
                            font-size: 13px;
                        }

                        .controls {
                            display: flex;
                            flex-wrap: wrap;
                            align-items: center;
                            gap: 14px;
                        }

                        .control {
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            color: #f6f8fb;
                            font-size: 13px;
                            font-weight: 400;
                            white-space: nowrap;
                        }

                        .zoom-input {
                            width: 176px;
                            height: 24px;
                            margin: 0;
                            -webkit-appearance: none;
                            appearance: none;
                            accent-color: #d7dde5;
                            background: transparent;
                            cursor: pointer;
                            touch-action: none;
                        }

                        .zoom-input:focus {
                            outline: none;
                        }

                        .zoom-input:focus-visible {
                            border-radius: 999px;
                            outline: 2px solid rgb(255 255 255 / 52%);
                            outline-offset: 3px;
                        }

                        .zoom-input::-webkit-slider-runnable-track {
                            height: 6px;
                            border-radius: 999px;
                            background: rgb(215 221 229 / 42%);
                        }

                        .zoom-input::-webkit-slider-thumb {
                            width: 18px;
                            height: 18px;
                            margin-top: -6px;
                            -webkit-appearance: none;
                            appearance: none;
                            border: 2px solid #ffffff;
                            border-radius: 999px;
                            background: #d7dde5;
                            box-shadow: 0 2px 8px rgb(0 0 0 / 22%);
                            cursor: grab;
                        }

                        .zoom-input:active::-webkit-slider-thumb {
                            cursor: grabbing;
                        }

                        .zoom-input::-moz-range-track {
                            height: 6px;
                            border: 0;
                            border-radius: 999px;
                            background: rgb(215 221 229 / 42%);
                        }

                        .zoom-input::-moz-range-thumb {
                            width: 18px;
                            height: 18px;
                            border: 2px solid #ffffff;
                            border-radius: 999px;
                            background: #d7dde5;
                            box-shadow: 0 2px 8px rgb(0 0 0 / 22%);
                            cursor: grab;
                        }

                        .zoom-input:active::-moz-range-thumb {
                            cursor: grabbing;
                        }

                        main {
                            padding: 24px;
                        }

                        .test-section + .test-section {
                            margin-top: 36px;
                        }

                        .section-header {
                            display: flex;
                            align-items: baseline;
                            justify-content: space-between;
                            gap: 16px;
                            margin-bottom: 12px;
                        }

                        h2 {
                            margin: 0;
                            font-size: 15px;
                            font-weight: 650;
                        }

                        .section-count {
                            color: #d7dde5;
                            font-size: 12px;
                        }

                        .gallery {
                            display: grid;
                            grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
                            gap: 16px;
                        }

                        .screenshot-card {
                            display: grid;
                            gap: 8px;
                            min-width: 0;
                            padding: 0;
                            border: 0;
                            background: transparent;
                            color: inherit;
                            text-align: left;
                            cursor: zoom-in;
                        }

                        .screenshot-frame {
                            aspect-ratio: 1366 / 1024;
                            overflow: hidden;
                            background: #5f6670;
                        }

                        .screenshot-frame img {
                            display: block;
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                            object-position: top left;
                        }

                        html[data-color-scheme="light"] .screenshot-image--dark,
                        html[data-color-scheme="dark"] .screenshot-image--light {
                            display: none;
                        }

                        .screenshot-title {
                            overflow: hidden;
                            color: #d7dde5;
                            font-size: 12px;
                            font-weight: 400;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        }

                        .modal {
                            position: fixed;
                            inset: 0;
                            z-index: 10;
                            display: grid;
                            grid-template-rows: minmax(0, 1fr) auto;
                            gap: 12px;
                            padding: 24px;
                            background: #5f6670;
                        }

                        .modal:focus {
                            outline: none;
                        }

                        .modal[hidden] {
                            display: none;
                        }

                        .modal-image-wrap {
                            display: grid;
                            min-height: 0;
                            place-items: center;
                        }

                        .modal-button {
                            display: grid;
                            place-items: center;
                            border: 1px solid rgb(255 255 255 / 22%);
                            border-radius: 999px;
                            background: rgb(20 24 29 / 56%);
                            box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
                            color: #ffffff;
                            cursor: pointer;
                            transition:
                                background 120ms ease,
                                border-color 120ms ease,
                                transform 120ms ease;
                        }

                        .modal-button:hover {
                            border-color: rgb(255 255 255 / 36%);
                            background: rgb(20 24 29 / 72%);
                        }

                        .modal-button:focus {
                            outline: none;
                        }

                        .modal-button:focus-visible {
                            outline: 2px solid rgb(255 255 255 / 64%);
                            outline-offset: 3px;
                        }

                        .modal-button svg {
                            width: 20px;
                            height: 20px;
                            pointer-events: none;
                        }

                        .modal-nav-button {
                            position: fixed;
                            top: 50%;
                            width: 44px;
                            height: 72px;
                            transform: translateY(-50%);
                        }

                        .modal-nav-button:active {
                            transform: translateY(-50%) scale(0.97);
                        }

                        .modal-nav-button--previous {
                            left: 24px;
                        }

                        .modal-nav-button--next {
                            right: 24px;
                        }

                        .modal-image {
                            max-width: calc(100vw - 48px);
                            max-height: calc(100vh - 92px);
                            background: #ffffff;
                        }

                        .modal-footer {
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 16px;
                            min-height: 32px;
                            color: #eef3f8;
                        }

                        .modal-caption {
                            overflow: hidden;
                            font-size: 13px;
                            font-weight: 400;
                            text-overflow: ellipsis;
                            user-select: text;
                            white-space: nowrap;
                        }

                        .modal-close {
                            flex: 0 0 auto;
                            width: 36px;
                            height: 36px;
                        }

                        .modal-close svg {
                            width: 18px;
                            height: 18px;
                        }

                        .modal-close:active {
                            transform: scale(0.96);
                        }

                        @media (max-width: 820px) {
                            .page-header,
                            main {
                                padding-right: 16px;
                                padding-left: 16px;
                            }

                            .gallery {
                                gap: 12px;
                            }

                            .modal-nav-button--previous {
                                left: 8px;
                            }

                            .modal-nav-button--next {
                                right: 8px;
                            }
                        }
                    </style>
                </head>
                <body>
                    <header class="page-header">
                        <div class="title">
                            <h1>Screenshot Test Preview</h1>
                            <p class="summary">
                                ${escapeHtml(
                                    `${formatCount(images.length, "screenshot")} across ${formatCount(
                                        testNames.length,
                                        "test",
                                    )}`,
                                )}
                            </p>
                        </div>
                        <div class="controls">
                            <label class="control">
                                <input id="colorSchemeInput" type="checkbox" />
                                Dark mode
                            </label>
                            <div class="control">
                                <label id="columnsLabel" for="columnsInput">3 per row</label>
                                <input
                                    id="columnsInput"
                                    class="zoom-input"
                                    type="range"
                                    min="1"
                                    max="6"
                                    step="1"
                                    value="3"
                                />
                            </div>
                        </div>
                    </header>

                    <main>${screenshotSectionsHtml}</main>

                    <div
                        id="modal"
                        class="modal"
                        role="dialog"
                        aria-modal="true"
                        tabindex="-1"
                        hidden
                    >
                        <button
                            id="modalPrevious"
                            class="modal-button modal-nav-button modal-nav-button--previous"
                            type="button"
                            aria-label="Previous screenshot"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.25"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                                focusable="false"
                            >
                                <path d="M15 6 9 12l6 6" />
                            </svg>
                        </button>
                        <button
                            id="modalNext"
                            class="modal-button modal-nav-button modal-nav-button--next"
                            type="button"
                            aria-label="Next screenshot"
                        >
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.25"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                                focusable="false"
                            >
                                <path d="m9 18 6-6-6-6" />
                            </svg>
                        </button>
                        <div class="modal-image-wrap">
                            <img id="modalImage" class="modal-image" alt="" />
                        </div>
                        <div class="modal-footer">
                            <div id="modalCaption" class="modal-caption"></div>
                            <button
                                id="modalClose"
                                class="modal-button modal-close"
                                type="button"
                                aria-label="Close"
                            >
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.25"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    aria-hidden="true"
                                    focusable="false"
                                >
                                    <path d="M6 6l12 12M18 6 6 18" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <script>
                        const root = document.documentElement;
                        const colorSchemeInput = document.getElementById("colorSchemeInput");
                        const columnsInput = document.getElementById("columnsInput");
                        const columnsLabel = document.getElementById("columnsLabel");
                        const modal = document.getElementById("modal");
                        const modalImage = document.getElementById("modalImage");
                        const modalCaption = document.getElementById("modalCaption");
                        const modalClose = document.getElementById("modalClose");
                        const modalPrevious = document.getElementById("modalPrevious");
                        const modalNext = document.getElementById("modalNext");
                        const cards = Array.from(document.querySelectorAll(".screenshot-card"));
                        let openCardIndex = null;
                        let previouslyFocusedElement = null;

                        function getColorScheme() {
                            return colorSchemeInput.checked ? "dark" : "light";
                        }

                        function getOpenCard() {
                            if (openCardIndex === null) return null;
                            return cards[openCardIndex] ?? null;
                        }

                        function updateModalImage() {
                            const openCard = getOpenCard();
                            if (openCard === null) return;

                            const src =
                                getColorScheme() === "dark"
                                    ? openCard.dataset.darkSrc
                                    : openCard.dataset.lightSrc;
                            modalImage.src = src;
                        }

                        function setColorScheme() {
                            root.dataset.colorScheme = getColorScheme();
                            updateModalImage();
                        }

                        function setColumns() {
                            const columns = columnsInput.value;
                            root.style.setProperty("--columns", columns);
                            columnsLabel.textContent = columns + " per row";
                        }

                        function closeModal() {
                            modal.hidden = true;
                            modalImage.removeAttribute("src");
                            modalCaption.textContent = "";
                            document.body.classList.remove("is-modal-open");
                            openCardIndex = null;

                            const elementToFocus = previouslyFocusedElement;
                            previouslyFocusedElement = null;
                            if (elementToFocus instanceof HTMLElement) {
                                elementToFocus.focus({preventScroll: true});
                            }
                        }

                        function openModalAtIndex(index) {
                            if (cards.length === 0) return;

                            const isOpeningModal = modal.hidden;
                            if (isOpeningModal) {
                                previouslyFocusedElement = document.activeElement;
                            }

                            openCardIndex = (index + cards.length) % cards.length;
                            const openCard = getOpenCard();
                            if (openCard === null) return;

                            updateModalImage();
                            const modalTitle =
                                openCard.dataset.modalTitle ?? openCard.dataset.title ?? "";
                            modalCaption.textContent = modalTitle;
                            modalImage.alt = modalTitle;
                            modal.hidden = false;
                            document.body.classList.add("is-modal-open");

                            if (isOpeningModal) {
                                modal.focus({preventScroll: true});
                            }
                        }

                        function openModal(card) {
                            const index = Number(card.dataset.index);
                            if (!Number.isInteger(index)) return;

                            openModalAtIndex(index);
                        }

                        function showAdjacentScreenshot(direction) {
                            if (openCardIndex === null) return;
                            openModalAtIndex(openCardIndex + direction);
                        }

                        colorSchemeInput.addEventListener("change", setColorScheme);
                        columnsInput.addEventListener("input", setColumns);
                        modalClose.addEventListener("click", closeModal);
                        modalPrevious.addEventListener("click", () => showAdjacentScreenshot(-1));
                        modalNext.addEventListener("click", () => showAdjacentScreenshot(1));
                        modal.addEventListener("click", event => {
                            const target = event.target;
                            if (!(target instanceof Element)) return;
                            if (target.closest(".modal-image, .modal-button, .modal-footer"))
                                return;
                            closeModal();
                        });
                        window.addEventListener("keydown", event => {
                            if (modal.hidden) return;

                            if (event.key === "Escape") {
                                closeModal();
                            } else if (event.key === "ArrowLeft") {
                                event.preventDefault();
                                showAdjacentScreenshot(-1);
                            } else if (event.key === "ArrowRight") {
                                event.preventDefault();
                                showAdjacentScreenshot(1);
                            }
                        });

                        for (const card of cards) {
                            card.addEventListener("click", () => openModal(card));
                        }

                        setColorScheme();
                        setColumns();
                    </script>
                </body>
            </html>
        `,
        {
            parser: "html",
            printWidth: 80,
            tabWidth: 2,
            htmlWhitespaceSensitivity: "ignore",
            plugins: [htmlPrettierPlugin],
        },
    );
}

function formatCount(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function printScreenshotTestPreviewSectionHtml({
    testName,
    images,
}: {
    testName: string;
    images: ReadonlyArray<ScreenshotTestPreviewIndexedImage>;
}): string {
    const screenshotCardsHtml = images.map(printScreenshotTestPreviewCardHtml).join("\n");

    return html`
        <section class="test-section">
            <div class="section-header">
                <h2>${escapeHtml(testName)}</h2>
                <div class="section-count">
                    ${escapeHtml(formatCount(images.length, "screenshot"))}
                </div>
            </div>
            <div class="gallery">${screenshotCardsHtml}</div>
        </section>
    `;
}

function printScreenshotTestPreviewCardHtml(image: ScreenshotTestPreviewIndexedImage): string {
    const title = image.screenshotName.replaceAll("-", " ");

    return html`
        <button
            class="screenshot-card"
            type="button"
            data-index="${escapeHtml(String(image.index))}"
            data-title="${escapeHtml(title)}"
            data-modal-title="${escapeHtml(`${image.testName}: ${title}`)}"
            data-light-src="${escapeHtml(image.lightPath)}"
            data-dark-src="${escapeHtml(image.darkPath)}"
        >
            <span class="screenshot-frame">
                <img
                    class="screenshot-image screenshot-image--light"
                    src="${escapeHtml(image.lightPath)}"
                    alt="${escapeHtml(title)}"
                    loading="lazy"
                />
                <img
                    class="screenshot-image screenshot-image--dark"
                    src="${escapeHtml(image.darkPath)}"
                    alt="${escapeHtml(title)}"
                    loading="lazy"
                />
            </span>
            <span class="screenshot-title">${escapeHtml(title)}</span>
        </button>
    `;
}
