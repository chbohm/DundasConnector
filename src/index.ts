import { DundasConnector, DundasAccount, Logger } from './dundasConnector';


export function createConnector(dundasUrl: string, dundasAdmin: string, password: string, accounts:DundasAccount[] , logger: Logger) {
    return new DundasConnector(dundasUrl, dundasAdmin, password, accounts, logger);
}