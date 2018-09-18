"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const request = require("requestretry");
const url = require("url");
const INVALID_SESSION_ERROR = 'Dundas.BI.InvalidSessionException';
function createConnector(dundasUrl, dundasAdmin, password, accounts, logger) {
    return new DundasConnector(dundasUrl, dundasAdmin, password, accounts, logger);
}
exports.createConnector = createConnector;
class DundasConnector {
    constructor(dundasUrl, dundasAdmin, dundasPassword, accounts, logger) {
        this.dundasAdmin = dundasAdmin;
        this.logger = logger;
        this.sessionsMap = new Map();
        this.accountMap = new Map();
        dundasUrl = dundasUrl.charAt(dundasUrl.length - 1) === '/' ? dundasUrl.substring(0, dundasUrl.length - 1) : dundasUrl;
        let parsedUrl = url.parse(dundasUrl);
        this.dundasUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.path}`;
        accounts.forEach((account) => {
            this.accountMap.set(account.accountName, account);
        });
        this.accountMap.set(dundasAdmin, { accountName: dundasAdmin, password: dundasPassword, isWindowsLogOn: false });
    }
    getSessionId(accountName) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.info(`Getting SessionId for account: ${accountName}`);
            let sessionId = this.sessionsMap.get(accountName);
            if (yield this.isValid(sessionId)) {
                return sessionId;
            }
            let adminSessionId = yield this.getAdminSessionId();
            sessionId = yield this.getExistingSessionIdFromDundas(adminSessionId, accountName);
            if (sessionId) {
                this.sessionsMap.set(accountName, sessionId);
                return sessionId;
            }
            sessionId = yield this.createNewSessionFromDundas(accountName);
            if (sessionId) {
                this.sessionsMap.set(accountName, sessionId);
                return sessionId;
            }
            throw new Error('Could not create session id');
        });
    }
    getAdminSessionId() {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.info('Getting Adming SessionId');
            let sessionId = this.sessionsMap.get(this.dundasAdmin);
            if (yield this.isValid(sessionId)) {
                return sessionId;
            }
            sessionId = yield this.createNewSessionFromDundas(this.dundasAdmin);
            if (sessionId) {
                this.sessionsMap.set(this.dundasAdmin, sessionId);
                return sessionId;
            }
            throw new Error('Could not create admin session');
        });
    }
    createNewSessionFromDundas(accountName) {
        return __awaiter(this, void 0, void 0, function* () {
            let account = this.accountMap.get(accountName);
            if (!account) {
                throw new Error(`No configuration found for dundas account: ${accountName}`);
            }
            const options = this.buildRequestOptions('POST', '/Api/LogOn', account);
            let stream = yield this.doRequest(options);
            let response = {
                sessionId: stream.body.sessionId,
                message: stream.body.message,
                logOnFailureReason: stream.body.logOnFailureReason,
            };
            if (response.sessionId === undefined) {
                let message = response.logOnFailureReason || 'Error retrieving sessionId from BI server';
                this.logger.error(message, { Response: response, AccountName: accountName });
                throw new Error(message);
            }
            this.logger.info('New Dundas Session ID retrieved', { SessionData: response, AccountName: accountName });
            return response.sessionId;
        });
    }
    getExistingSessionIdFromDundas(adminSessionId, accountName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!adminSessionId) {
                return undefined;
            }
            let sessionDetails = yield this.getSessionDetailsFromDundas(adminSessionId, accountName);
            return sessionDetails ? sessionDetails.id : undefined;
        });
    }
    getSessionDetailsFromDundas(adminSessionId, accountName) {
        return __awaiter(this, void 0, void 0, function* () {
            let body = {
                querySessionsOptions: {
                    filter: [
                        {
                            field: 'seatKind',
                            operator: 'Equals',
                            value: 'StandardUser'
                        },
                        {
                            field: 'IsSeatReserved',
                            operator: 'Equals',
                            value: false
                        }
                    ]
                }
            };
            const options = this.buildRequestOptions('POST', '/Api/Session/Query', body, { sessionId: adminSessionId });
            this.logger.debug('Requesting dundas session id', { Options: options, Account: accountName });
            let stream = yield this.doRequest(options);
            let response = stream.body;
            let sessions = response.filter((sessionDetail) => {
                return sessionDetail.accountName = accountName;
            });
            if (sessions.length === 0) {
                return undefined;
            }
            return sessions[0];
        });
    }
    isValid(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!sessionId) {
                return false;
            }
            const options = this.buildRequestOptions('GET', '/Api/Session/IsValid', undefined, { sessionId: sessionId });
            this.logger.debug('Validating session id', { Options: options, SessionId: sessionId });
            let stream = yield this.doRequest(options);
            return stream.body;
        });
    }
    buildRequestOptions(method, path, json, qs) {
        let request = {
            method: method,
            url: `${this.dundasUrl}${path}`
        };
        if (json) {
            request.json = json;
        }
        if (qs) {
            request.qs = qs;
        }
        const baseRequestObj = {
            maxAttempts: 3,
            retryDelay: 1000,
            retryStrategy: this.retryStrategy.bind(this)
        };
        Object.assign(request, baseRequestObj);
        return request;
    }
    retryStrategy(err, response, body) {
        const isHTTPOrNetworkError = !!request.RetryStrategies.HTTPOrNetworkError(err, response);
        if (isHTTPOrNetworkError) {
            console.error('HTTP or Network Error. Trying to connect to Dundas server again.', { Url: this.dundasUrl });
        }
        return isHTTPOrNetworkError;
    }
    doRequest(options, nRetries = 3) {
        return __awaiter(this, void 0, void 0, function* () {
            this.logger.debug('Dundas request', { Endpoint: { HRef: options.url, Method: options.method }, Params: options.json });
            let response = yield request(options);
            this.logger.debug('Dundas response', { Response: response.body });
            this.checkResponse(response);
            return response;
        });
    }
    checkResponse(stream) {
        if (stream.statusCode !== 200) {
            if (stream.body && stream.body.ExceptionType === 'Dundas.BI.InvalidSessionException') {
                throw new Error('Dundas.BI.InvalidSessionException');
            }
            else {
                throw new Error('Bad response' + stream.body);
            }
        }
    }
}
exports.DundasConnector = DundasConnector;
//# sourceMappingURL=dundasConnector.js.map