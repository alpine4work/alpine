import {getInteractionModality, setInteractionModality} from "@react-aria/interactions";
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
 * then closes it without making a selection. The way this works is we have to add
 * an invisible element as a child of `containerElement`. So our invisible element
 * will be cleaned up at the same time as `containerElement` if the user didn't
 * make a file selection.
 */
export function selectFiles(
    containerElement: Element,
    {
        multiple,
        acceptContentTypes = null,
        onReturnFocus,
    }: {
        multiple: boolean;
        acceptContentTypes?: ReadonlyArray<FileContentType> | null;
        onReturnFocus?: () => void;
    },
): Promise<Array<File>> {
    return new Promise(resolve => {
        const originalInteractionModality = getInteractionModality();

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

        const resolveAndCleanup = (files: Array<File>) => {
            document.removeEventListener("focusin", handleDocumentFocusIn);

            // Make sure to return the interaction modality to whatever it was when
            // `selectFiles()` was called. The interaction modality may change to `virtual`
            // since we call `temporaryInputElement.click()` which will render `<FocusRing>`s
            // which we don't want.
            setInteractionModality(originalInteractionModality);

            // Give the caller an opportunity to return focus back to some element before we
            // remove the currently focused element from the DOM.
            onReturnFocus?.();

            temporaryInputElement.remove();

            resolve(files);
        };

        temporaryInputElement.addEventListener("change", () => {
            const files = temporaryInputElement.files
                ? Array.from(temporaryInputElement.files)
                : [];

            resolveAndCleanup(files);
        });

        const handleDocumentFocusIn = (event: FocusEvent) => {
            if (event.target !== temporaryInputElement) {
                resolveAndCleanup([]);
            }
        };

        // If we focus on anything other than `temporaryInputElement` then resolve this
        // promise with an empty array since it probably means our file selection dialog
        // closed. We can't listen for `blur`/`focusout` events because:
        //
        // 1. The `blur` event doesn't fire if the focused element is removed from the DOM
        //    in Safari (I think I remember this being the case?).
        //
        // 2. It looks like in Chrome the `blur` event is fired immediately after the file
        //    selection dialog opens. Probably because focus is leaving the window and
        //    entering the selection dialog.
        document.addEventListener("focusin", handleDocumentFocusIn);

        containerElement.appendChild(temporaryInputElement);

        // This focus call is important. It makes sure that the `focusout` event is fired
        // with this element as its `event.relatedTarget`. This way if we're in a post
        // inline content editor, `useConfirmSaveAfterLosingFocus()` will see that this
        // element is a child of our content editor and won't cancel post editing.
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
