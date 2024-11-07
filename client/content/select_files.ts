import {
    FileContentType,
    fileAdditionalContentTypesAndExtensionsByContentType,
    getFileContentTypePreferredExtension,
} from "~/shared/files/file_content_type.js";

/**
 * Opens the browser file selector and returns a promise that resolves once the
 * user has selected some files.
 *
 * Currently the promise never resolves if the user opens the file selector and
 * then closes it without making a selection. The way this works is we have to
 * add an invisible element as a child of `containerElement`. So our invisible
 * element will be cleaned up at the same time as `containerElement` if the
 * user didn't make a file selection.
 */
export function selectFiles(
    containerElement: Element,
    {
        multiple,
        acceptContentTypes = null,
    }: {
        multiple: boolean;
        acceptContentTypes?: ReadonlyArray<FileContentType> | null;
    },
): Promise<Array<File>> {
    return new Promise(resolve => {
        const temporaryInputElement = document.createElement("input");
        temporaryInputElement.type = "file";
        temporaryInputElement.multiple = multiple;

        if (acceptContentTypes !== null)
            temporaryInputElement.accept = getFileInputAcceptAttribute(acceptContentTypes);

        temporaryInputElement.style.width = "0";
        temporaryInputElement.style.height = "0";
        temporaryInputElement.style.margin = "0";
        temporaryInputElement.style.padding = "0";
        temporaryInputElement.style.border = "0";
        temporaryInputElement.style.opacity = "0";
        temporaryInputElement.style.position = "fixed";
        temporaryInputElement.style.top = "0px";

        temporaryInputElement.addEventListener("change", () => {
            temporaryInputElement.remove();

            const files = temporaryInputElement.files
                ? Array.from(temporaryInputElement.files)
                : [];
            resolve(files);
        });

        containerElement.appendChild(temporaryInputElement);

        // This focus call is important. It makes sure that the `focusout` event is
        // fired with this element as its `event.relatedTarget`. This way
        // if we're in a post inline content editor, `useConfirmSaveAfterLosingFocus()`
        // will see that this element is a child of our content editor and won't cancel
        // post editing.
        temporaryInputElement.focus();

        temporaryInputElement.click();
    });
}

function getFileInputAcceptAttribute(contentTypes: ReadonlyArray<FileContentType>): string {
    const items: Array<string> = [];

    for (const contentType of contentTypes) {
        const additionalContentTypesAndExtensions =
            fileAdditionalContentTypesAndExtensionsByContentType[contentType];

        items.push(contentType);

        if (additionalContentTypesAndExtensions?.contentTypes) {
            for (const additionalContentType of additionalContentTypesAndExtensions.contentTypes) {
                items.push(additionalContentType);
            }
        }

        items.push(`.${getFileContentTypePreferredExtension(contentType)}`);

        if (additionalContentTypesAndExtensions?.extensions) {
            for (const additionalExtension of additionalContentTypesAndExtensions?.extensions) {
                items.push(`.${additionalExtension}`);
            }
        }
    }

    return items.join(",");
}
