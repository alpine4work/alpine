import "~/client/bootstrap/bootstrap";

import type {AppProps} from "next/app";
import Head from "next/head";
import {IconContext} from "phosphor-react";
import {InitializeColorSchemeScript} from "~/client/ui/color-scheme";
import {spacing} from "~/shared/styles/spacing";

export default function MyApp({Component, pageProps}: AppProps) {
    return (
        <>
            <Head>
                <InitializeColorSchemeScript />
            </Head>
            <IconContext.Provider
                value={{
                    color: "currentColor",
                    size: spacing["spacing-5"],
                }}
            >
                <Component {...pageProps} />
            </IconContext.Provider>
        </>
    );
}
