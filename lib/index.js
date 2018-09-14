"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dundasConnector_1 = require("./dundasConnector");
function createConnector(dundasUrl, dundasAdmin, password, accounts, logger) {
    return new dundasConnector_1.DundasConnector(dundasUrl, dundasAdmin, password, accounts, logger);
}
exports.createConnector = createConnector;
//# sourceMappingURL=index.js.map