import * as request from 'requestretry';
import * as url from 'url';

type AccountName = string;
type SessionId = string;
const INVALID_SESSION_ERROR = 'Dundas.BI.InvalidSessionException';


export function createConnector(dundasUrl: string, dundasAdmin: string, password: string, accounts: DundasAccount[], logger: Logger) {
    return new DundasConnector(dundasUrl, dundasAdmin, password, accounts, logger);
}
export interface DundasAccount {
    accountName: AccountName;
    password: string;
    isWindowsLogOn: boolean;
}
export interface Logger {
    info(message: string, metadata?: any);
    debug(message: string, metadata?: any);
    warn(message: string, metadata?: any);
    error(message: string, metadata?: any);
}
interface RequestOption {
    method: string;
    url: string;
    qs?: any;
    json?: any;
}
export class DundasConnector {
    private dundasUrl: string;
    private sessionsMap = new Map<AccountName, SessionId>();
    private accountMap = new Map<AccountName, DundasAccount>();


    constructor(dundasUrl: string, private dundasAdmin: string, dundasPassword: string, accounts: DundasAccount[], private logger: Logger) {
        dundasUrl = dundasUrl.charAt(dundasUrl.length - 1) === '/' ? dundasUrl.substring(0, dundasUrl.length - 1) : dundasUrl;
        let parsedUrl = url.parse(dundasUrl);
        this.dundasUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.path}`;
        accounts.forEach((account) => {
            this.accountMap.set(account.accountName, account);
        });
        this.accountMap.set(dundasAdmin, { accountName: dundasAdmin, password: dundasPassword, isWindowsLogOn: false });
    }

    public async getSessionId(accountName: string): Promise<SessionId> {
        this.logger.info(`Getting SessionId for account: ${accountName}`);
        let sessionId = this.sessionsMap.get(accountName);
        if (await this.isValid(sessionId)) {
            return sessionId;
        }
        let adminSessionId = await this.getAdminSessionId();
        sessionId = await this.getExistingSessionIdFromDundas(adminSessionId, accountName);

        if (sessionId) {
            this.sessionsMap.set(accountName, sessionId);
            return sessionId;
        }


        sessionId = await this.createNewSessionFromDundas(accountName);
        if (sessionId) {
            this.sessionsMap.set(accountName, sessionId);
            return sessionId;
        }
        throw new Error('Could not create session id');
    }

    private async getAdminSessionId(): Promise<SessionId> {
        this.logger.info('Getting Adming SessionId');
        let sessionId = this.sessionsMap.get(this.dundasAdmin);
        if (await this.isValid(sessionId)) {
            return sessionId;
        }

        sessionId = await this.createNewSessionFromDundas(this.dundasAdmin);
        if (sessionId) {
            this.sessionsMap.set(this.dundasAdmin, sessionId);
            return sessionId;
        }
        throw new Error('Could not create admin session');
    }




    private async createNewSessionFromDundas(accountName: string): Promise<SessionId> {
        let account = this.accountMap.get(accountName);
        if (!account) {
            throw new Error(`No configuration found for dundas account: ${accountName}`);
        }
        const options = this.buildRequestOptions('POST', '/Api/LogOn', account);
        let stream = await this.doRequest(options);

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
    }


    private async getExistingSessionIdFromDundas(adminSessionId: string, accountName: string): Promise<SessionId> {
        if (!adminSessionId) {
            return undefined;
        }
        let sessionDetails = await this.getSessionDetailsFromDundas(adminSessionId, accountName);
        return sessionDetails ? sessionDetails.id : undefined;
    }

    private async getSessionDetailsFromDundas(adminSessionId: string, accountName: string): Promise<any> {
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
        }
        const options = this.buildRequestOptions('POST', '/Api/Session/Query', body, { sessionId: adminSessionId });
        this.logger.debug('Requesting dundas session id', { Options: options, Account: accountName });
        let stream = await this.doRequest(options);
        let response = stream.body;
        let sessions = response.filter((sessionDetail) => {
            return sessionDetail.accountName = accountName;
        });

        if (sessions.length === 0) {
            return undefined;
        }

        return sessions[0];
    }

    private async isValid(sessionId: SessionId): Promise<boolean> {
        if (!sessionId) {
            return false;
        }
        const options = this.buildRequestOptions('GET', '/Api/Session/IsValid', undefined, { sessionId: sessionId });
        this.logger.debug('Validating session id', { Options: options, SessionId: sessionId });
        let stream = await this.doRequest(options);
        return stream.body;
    }


    private buildRequestOptions(method: string, path: string, json?: any, qs?: any): any {
        let request: RequestOption = {
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

        Object.assign(request, baseRequestObj)
        return request;
    }


    private retryStrategy(err: any, response: any, body: any): boolean {
        const isHTTPOrNetworkError = !!request.RetryStrategies.HTTPOrNetworkError(err, response);
        if (isHTTPOrNetworkError) {
            console.error('HTTP or Network Error. Trying to connect to Dundas server again.', { Url: this.dundasUrl });
        }
        return isHTTPOrNetworkError;
    }

    private async doRequest(options: any, nRetries: number = 3): Promise<any> {
        this.logger.debug('Dundas request', { Endpoint: { HRef: options.url, Method: options.method }, Params: options.json });
        let response = await request(options);
        this.logger.debug('Dundas response', { Response: response.body });
        this.checkResponse(response);
        return response;

    }

    private checkResponse(stream: any) {
        if (stream.statusCode !== 200) {
            if (stream.body && stream.body.ExceptionType === 'Dundas.BI.InvalidSessionException') {
                throw new Error('Dundas.BI.InvalidSessionException');
            } else {
                throw new Error('Bad response' + stream.body);
            }
        }
    }




}