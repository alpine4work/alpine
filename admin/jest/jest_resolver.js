"use strict";

const path = require("path");

module.exports = (request, options) => {
    if (request.startsWith("~/")) {
        request = path.relative(options.basedir, path.resolve(`./${request.slice(2)}`));
        if (!request.startsWith("../")) {
            request = `./${request}`;
        }
    }
    return options.defaultResolver(request, options);
};
