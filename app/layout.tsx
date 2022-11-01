import "~/client/design/global-styles/global-styles.css";
import "~/client/design/sprinkles.css";

import {Fira_Code, Inter} from "@next/font/google";
import classNames from "classnames";
import {ReactNode} from "react";
import {RootClientHtml} from "~/app/root-client-html";

// TODO(calebmer): Aggressively show error dialog if unhandled error occurs.
// Like Next.js in dev. Maybe it should be dismissable? Like Next.js.

const inter = Inter({weight: "variable", subsets: ["latin"], variable: "--inter"});
const firaCode = Fira_Code({weight: "variable", subsets: ["latin"], variable: "--fira-code"});

export default function RootLayout({children}: {children: ReactNode}) {
    return (
        <RootClientHtml
            bodyClassName={classNames(inter.className, inter.variable, firaCode.variable)}
        >
            {children}
        </RootClientHtml>
    );
}
