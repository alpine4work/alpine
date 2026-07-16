import {Check, Copy} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";

/**
 * A quiet copy-to-clipboard button with a temporary "Copied" confirmation state.
 */
export function DocumentationCopyButton({text}: {text: string}) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        };
    }, []);

    return (
        <DocumentationUnstyledButton
            ariaLabel="Copy to clipboard"
            onClick={() => {
                navigator.clipboard.writeText(text).catch(() => {
                    // Clipboard access can be denied; the button quietly does nothing.
                });
                setCopied(true);
                if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
                timeoutRef.current = setTimeout(() => setCopied(false), 1200);
            }}
            box={{
                display: "inline-flex",
                alignItems: "center",
                gap: "1",
                paddingX: "2",
                paddingY: "1",
                borderRadius: "1.5",
                border: "grey-5",
                backgroundColor: "grey-0",
                color: copied ? "green-70" : "grey-50",
                fontSize: "50",
                fontStyle: "semi-bold",
                cursor: "pointer",
            }}
        >
            {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
        </DocumentationUnstyledButton>
    );
}
