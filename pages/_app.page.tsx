import "~/client/bootstrap/bootstrap";
import "~/client/bootstrap/bootstrap.css";

import type {AppProps} from "next/app";

export default function MyApp({Component, pageProps}: AppProps) {
    return <Component {...pageProps} />;
}
