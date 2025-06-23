// Reporter is in three separate files: `reporter.tsx`, `reporter_context.ts`,
// and `reporter_context_provider.tsx` to prevent `reporter.tsx` from importing
// `reporter_context_provider.tsx` which would create a cyclic import because
// `reporter_context_provider.tsx` imports UI components like `<IconButton>`
// which need the `useReporter()` hook. Cyclic imports degrade the HMR
// developer experience since all files in the cycle need to be re-evaluated
// on change.

import {useContext} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {Reporter, ReporterContext} from "~/client/design/internal/reporter_context.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";

// Re-export `Reporter` for files that can't import from `client/design/internal`.
export type {Reporter};

const reporterForTest: Reporter | null = import.meta.jest
    ? markMemoIfNotRendering({
          showDialog: () => {
              throw new UnimplementedError("Can’t present dialog in test");
          },
          hasDialogWithKey: () => {
              return false;
          },
          displayError: () => {
              throw new UnimplementedError("Can’t display error in test");
          },
          logErrorWithoutDisplaying: () => {
              throw new UnimplementedError("Can’t log error in test");
          },
          showInfoToast: () => {
              throw new UnimplementedError("Can’t show toast in test");
          },
      })
    : null;

export function useReporter(): Reporter {
    const reporter = useContext(ReporterContext);

    if (reporter === null) {
        // In unit tests, throw only when `showToast()` is called.
        if (reporterForTest) return reporterForTest;

        throw new InternalError("Must render in a `<ReporterContextProvider>` to display errors");
    }

    // We only return early in unit tests. So we're ok with breaking the rules of
    // hooks here.
    //
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const context = useAppContext();

    return reporter.cache.getOrSetDefault(context);
}
