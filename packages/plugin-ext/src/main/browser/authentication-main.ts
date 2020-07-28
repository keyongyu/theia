/********************************************************************************
 * Copyright (C) 2020 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { interfaces } from 'inversify';
import { AuthenticationExt, AuthenticationMain, MAIN_RPC_CONTEXT } from '../../common/plugin-api-rpc';
import { RPCProtocol } from '../../common/rpc-protocol';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common';
import { AuthenticationSession } from '@theia/plugin';
import { StorageService } from '@theia/core/lib/browser';
import { QuickPickOptions, QuickPickService } from '@theia/core/lib/common/quick-pick-service';
import {
    AllowedExtension, AuthenticationProvider,
    AuthenticationService,
    AuthenticationSessionsChangeEvent, readAllowedExtensions
} from '@theia/authentication/lib/browser/authentication-service';

export class AuthenticationMainImpl implements AuthenticationMain {
    private readonly proxy: AuthenticationExt;
    private readonly messageService: MessageService;
    private readonly storageService: StorageService;
    private readonly quickPickService: QuickPickService;
    private readonly authenticationService: AuthenticationService;
    constructor(rpc: RPCProtocol, container: interfaces.Container) {
        this.proxy = rpc.getProxy(MAIN_RPC_CONTEXT.AUTHENTICATION_EXT);
        this.messageService = container.get(MessageService);
        this.storageService = container.get(StorageService);
        this.quickPickService = container.get(QuickPickService);
        this.authenticationService = container.get(AuthenticationService);
    }
    async $registerAuthenticationProvider(id: string, displayName: string, supportsMultipleAccounts: boolean): Promise<void> {
        const provider = new AuthenticationProviderImp(this.proxy, id, displayName, supportsMultipleAccounts, this.messageService, this.storageService, this.quickPickService);
        await provider.initialize();
        this.authenticationService.registerAuthenticationProvider(id, provider);
    }

    async $fireSessionsChanged(providerId: string, event: AuthenticationSessionsChangeEvent): Promise<void> {
        console.log('>>>>');
    }

    async $unregisterAuthenticationProvider(id: string): Promise<void> {
        console.log('>>>>');
    }

    async $getSessionsPrompt(providerId: string, accountName: string, providerName: string, extensionId: string, extensionName: string): Promise<boolean> {
        const allowList = await readAllowedExtensions(this.storageService, providerId, accountName);
        const extensionData = allowList.find(extension => extension.id === extensionId);
        if (extensionData) {
            addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
            return true;
        }

        // const remoteConnection = this.remoteAgentService.getConnection();
        // if (remoteConnection && remoteConnection.remoteAuthority && remoteConnection.remoteAuthority.startsWith('vsonline') && VSO_ALLOWED_EXTENSIONS.includes(extensionId)) {
        //     addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
        //     return true;
        // }

        const choice = await this.messageService.info(`The extension '${extensionName}' wants to access the ${providerName} account '${accountName}'.`, 'Allow', 'Cancel');

        const allow = choice === 'Allow';
        if (allow) {
            await addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
            allowList.push({ id: extensionId, name: extensionName });
            await this.storageService.setData(`${providerId}-${accountName}`, JSON.stringify(allowList));
        }

        return allow;
    }

    async $getSession(providerId: string, extensionId: string, extensionName: string, scopes: string[],
                      options: { createIfNone?: boolean, clearSessionPreference?: boolean }): Promise<AuthenticationSession | undefined> {
        const orderedScopes = scopes.sort().join(' ');
        const sessions = await this.authenticationService.getSessions(providerId);
        sessions.filter(session => session.scopes.sort().join(' ') === orderedScopes);
        const displayName = this.authenticationService.getDisplayName(providerId);
        if (sessions.length) {
            if (!this.authenticationService.supportsMultipleAccounts(providerId)) {
                const session = sessions[0];
                const allowed = await this.$getSessionsPrompt(providerId, session.account.displayName, displayName, extensionId, extensionName);
                if (allowed) {
                    return session;
                } else {
                    throw new Error('User did not consent to login.');
                }
            }

            // On renderer side, confirm consent, ask user to choose between accounts if multiple sessions are valid
            const selected = await this.$selectSession(providerId, displayName, extensionId, extensionName, sessions, scopes, !!options.clearSessionPreference);
            return sessions.find(session => session.id === selected.id);
        } else {
            if (options.createIfNone) {
                const isAllowed = await this.$loginPrompt(displayName, extensionName);
                if (!isAllowed) {
                    throw new Error('User did not consent to login.');
                }

                const session = await this.authenticationService.login(providerId, scopes);
                await this.$setTrustedExtension(providerId, session.account.displayName, extensionId, extensionName);
                return session;
            } else {
                await this.$requestNewSession(providerId, scopes, extensionId, extensionName);
                return undefined;
            }
        }
    }
}

async function addAccountUsage(storageService: StorageService, providerId: string, accountName: string, extensionId: string, extensionName: string): Promise<void> {
    const accountKey = `${providerId}-${accountName}-usages`;
    const usages = await readAccountUsages(storageService, providerId, accountName);

    const existingUsageIndex = usages.findIndex(usage => usage.extensionId === extensionId);
    if (existingUsageIndex > -1) {
        usages.splice(existingUsageIndex, 1, {
            extensionId,
            extensionName,
            lastUsed: Date.now()
        });
    } else {
        usages.push({
            extensionId,
            extensionName,
            lastUsed: Date.now()
        });
    }

    await storageService.setData(accountKey, JSON.stringify(usages));
}

interface AccountUsage {
    extensionId: string;
    extensionName: string;
    lastUsed: number;
}

export class AuthenticationProviderImp implements AuthenticationProvider, Disposable {
    private accounts = new Map<string, string[]>(); // Map account name to session ids
    private sessions = new Map<string, string>(); // Map account id to name

    constructor(
        private readonly proxy: AuthenticationExt,
        public readonly id: string,
        public readonly displayName: string,
        public readonly supportsMultipleAccounts: boolean,
        private readonly messageService: MessageService,
        private readonly storageService: StorageService,
        private readonly quickPickService: QuickPickService
    ) {}

    public async initialize(): Promise<void> {
        return this.registerCommandsAndContextMenuItems();
    }

    public hasSessions(): boolean {
        return !!this.sessions.size;
    }

    public async manageTrustedExtensions(accountName: string): Promise<void> {
        // quickPick.canSelectMany = true;
        const allowedExtensions = await readAllowedExtensions(this.storageService, this.id, accountName);
        const usages = await readAccountUsages(this.storageService, this.id, accountName);
        const items = allowedExtensions.map(extension => {
            const usage = usages.find(u => extension.id === u.extensionId);
            return {
                label: 'label',
                value: {
                    label: extension.name,
                    description: usage
                        // TODO ? nls.localize({ key: 'accountLastUsedDate', comment: ['The placeholder {0} is a string with
                        //  time information, such as "3 days ago"'] }, "Last used this account {0}", fromNow(usage.lastUsed, true))
                        ? 'Last used this account {0}'
                        : 'Has not used this account',
                    extension
                }
            };
        });
        const options: QuickPickOptions = {};
        // options.selectedItems = items;
        options.title = 'Manage Trusted Extensions';
        options.placeholder = 'Choose which extensions can access this account';

        // options.onDidAccept(() => {
        //     const updatedAllowedList = quickPick.selectedItems.map(item => item.extension);
        //     this.storageService.store(`${this.id}-${accountName}`, JSON.stringify(updatedAllowedList), StorageScope.GLOBAL);
        //
        //     quickPick.dispose();
        // });
        //
        // options.onDidHide(() => {
        //     quickPick.dispose();
        // });
        const quickPick = await this.quickPickService.show<{ label: string, description: string, extension: AllowedExtension }>(items);
        if (quickPick) {
            this.storageService.setData(`${this.id}-${accountName}`, JSON.stringify(quickPick));
        }
    }

    private async registerCommandsAndContextMenuItems(): Promise<void> {
        const sessions = await this.proxy.$getSessions(this.id);
        sessions.forEach((session: AuthenticationSession) => this.registerSession(session));
    }

    private registerSession(session: AuthenticationSession): void {
        this.sessions.set(session.id, session.account.displayName);

        const existingSessionsForAccount = this.accounts.get(session.account.displayName);
        if (existingSessionsForAccount) {
            this.accounts.set(session.account.displayName, existingSessionsForAccount.concat(session.id));
            return;
        } else {
            this.accounts.set(session.account.displayName, [session.id]);
        }

        // this.storageKeysSyncRegistryService.registerStorageKey({ key: `${this.id}-${session.account.displayName}`, version: 1 });
    }

    async signOut(accountName: string): Promise<void> {
        const accountUsages = await readAccountUsages(this.storageService, this.id, accountName);
        const sessionsForAccount = this.accounts.get(accountName);

        // const result = await this.dialogService.confirm({
        const result = await this.messageService.warn(`The account ${accountName} has been used by:
        \n\n${accountUsages.map(usage => usage.extensionName).join('\n')}\n\n Sign out of these features?`,  'Yes');
        //     title: nls.localize('signOutConfirm', "),
        //     message: accountUsages.length
        //         ? nls.localize('signOutMessagve', )
        //         : nls.localize('signOutMessageSimple', "Sign out of {0}?", accountName)
        // });

        if (result) {
            if (sessionsForAccount) {
                sessionsForAccount.forEach(sessionId => this.logout(sessionId));
            }
            removeAccountUsage(this.storageService, this.id, accountName);
        }
    }

    async getSessions(): Promise<ReadonlyArray<AuthenticationSession>> {
        return this.proxy.$getSessions(this.id);
    }

    async updateSessionItems(event: AuthenticationSessionsChangeEvent): Promise<void> {
        const { added, removed } = event;
        const session = await this.proxy.$getSessions(this.id);
        const addedSessions = session.filter(s => added.some(id => id === s.id));

        removed.forEach((sessionId: string) => {
            const accountName = this.sessions.get(sessionId);
            if (accountName) {
                this.sessions.delete(sessionId);
                const sessionsForAccount = this.accounts.get(accountName) || [];
                const sessionIndex = sessionsForAccount.indexOf(sessionId);
                sessionsForAccount.splice(sessionIndex);

                if (!sessionsForAccount.length) {
                    this.accounts.delete(accountName);
                }
            }
        });

        addedSessions.forEach((s: AuthenticationSession) => this.registerSession(s));
    }

    login(scopes: string[]): Promise<AuthenticationSession> {
        return this.proxy.$login(this.id, scopes);
    }

    async logout(sessionId: string): Promise<void> {
        await this.proxy.$logout(this.id, sessionId);
        this.messageService.info('Successfully signed out.');
    }

    dispose(): void {
    }
}

async function readAccountUsages(storageService: StorageService, providerId: string, accountName: string): Promise<AccountUsage[]> {
    const accountKey = `${providerId}-${accountName}-usages`;
    const storedUsages: string | undefined = await storageService.getData(accountKey);
    let usages: AccountUsage[] = [];
    if (storedUsages) {
        try {
            usages = JSON.parse(storedUsages);
        } catch (e) {
            // ignore
        }
    }

    return usages;
}

function removeAccountUsage(storageService: StorageService, providerId: string, accountName: string): void {
    const accountKey = `${providerId}-${accountName}-usages`;
    storageService.setData(accountKey, undefined);
}
