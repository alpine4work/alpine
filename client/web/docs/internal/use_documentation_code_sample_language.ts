import {useSyncExternalStore} from "react";

export type DocumentationCodeSampleLanguage = "curl" | "node";

const storageKey = "alpineDocumentationCodeSampleLanguage";

// The language choice is global state shared by every code sample panel (and
// persisted) so panels never desync as the reader navigates between pages.
let currentLanguage: DocumentationCodeSampleLanguage = readStoredLanguage();
const listeners = new Set<() => void>();

function readStoredLanguage(): DocumentationCodeSampleLanguage {
    if (typeof localStorage === "undefined") return "curl";
    const stored = localStorage.getItem(storageKey);
    return stored === "node" ? "node" : "curl";
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot(): DocumentationCodeSampleLanguage {
    return currentLanguage;
}

function getServerSnapshot(): DocumentationCodeSampleLanguage {
    return "curl";
}

export function setDocumentationCodeSampleLanguage(language: DocumentationCodeSampleLanguage) {
    currentLanguage = language;
    try {
        localStorage.setItem(storageKey, language);
    } catch {
        // Persisting the choice is best-effort.
    }
    for (const listener of listeners) listener();
}

export function useDocumentationCodeSampleLanguage(): DocumentationCodeSampleLanguage {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
