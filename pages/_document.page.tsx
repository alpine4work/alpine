import Document, {DocumentContext, Head, Html, Main, NextScript} from "next/document";
import {withSessionInAsyncLocalStorage} from "~/server/session/session-async-local-storage";
import {Session} from "~/shared/session/session";

export default class MyDocument extends Document<{session?: Session}> {
    static override getInitialProps(context: DocumentContext) {
        if (context.req && context.res) {
            return withSessionInAsyncLocalStorage(
                {req: context.req, res: context.res},
                async session => {
                    const props = await Document.getInitialProps(context);
                    return {...props, session};
                },
            );
        } else {
            return Document.getInitialProps(context);
        }
    }

    override render() {
        const {session} = this.props;
        const sessionJsonString = session ? JSON.stringify(session) : null;
        return (
            <Html lang="en">
                <Head />
                <body>
                    <Main />
                    {sessionJsonString !== null && (
                        <script
                            type="application/javascript"
                            dangerouslySetInnerHTML={{
                                __html: `var session=${sessionJsonString};window.__GET_SESSION__=function(){return session}`,
                            }}
                        />
                    )}
                    <NextScript />
                </body>
            </Html>
        );
    }
}
