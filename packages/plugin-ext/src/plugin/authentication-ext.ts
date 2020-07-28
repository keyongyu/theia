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

import * as theia from '@theia/plugin';
import { Disposable } from './types-impl';
import {
    AuthenticationExt,
    AuthenticationMain,
    PLUGIN_RPC_CONTEXT
} from '../common/plugin-api-rpc';
import { RPCProtocol } from '../common/rpc-protocol';
import { Emitter, Event } from '@theia/core/lib/common';
import { AuthenticationSession } from '@theia/authentication/lib/browser/authentication-service';

export class AuthenticationExtImpl implements AuthenticationExt {
    private proxy: AuthenticationMain;
    private authenticationProviders: Map<string, theia.AuthenticationProvider> = new Map<string, theia.AuthenticationProvider>();

    private onDidChangeAuthenticationProvidersEmitter = new Emitter<theia.AuthenticationProvidersChangeEvent>();
    readonly onDidChangeAuthenticationProviders: Event<theia.AuthenticationProvidersChangeEvent> = this.onDidChangeAuthenticationProvidersEmitter.event;

    private onDidChangeSessionsEmitter = new Emitter<{ [providerId: string]: theia.AuthenticationSessionsChangeEvent }>();
    readonly onDidChangeSessions: Event<{ [providerId: string]: theia.AuthenticationSessionsChangeEvent }> = this.onDidChangeSessionsEmitter.event;

    constructor(rpc: RPCProtocol) {
        this.proxy = rpc.getProxy(PLUGIN_RPC_CONTEXT.AUTHENTICATION_MAIN);
    }

    registerAuthenticationProvider(provider: theia.AuthenticationProvider): Disposable {
        if (this.authenticationProviders.get(provider.id)) {
            throw new Error(`An authentication provider with id '${provider.id}' is already registered.`);
        }

        this.authenticationProviders.set(provider.id, provider);
        const listener = provider.onDidChangeSessions(e => {
            this.proxy.$fireSessionsChanged(provider.id, e);
        });

        this.proxy.$registerAuthenticationProvider(provider.id, provider.displayName, provider.supportsMultipleAccounts);

        return Disposable.create(() => {
            listener.dispose();
            this.authenticationProviders.delete(provider.id);
            this.proxy.$unregisterAuthenticationProvider(provider.id);
        });
    }

    async getProviderIds(): Promise<ReadonlyArray<string>> {
        return [];
    }
    async hasSessions(providerId: string, scopes: string[]): Promise<boolean> {
        return true;
    }
    async logout(providerId: string, sessionId: string): Promise<void> {
    }
    async getSession(providerId: string, scopes: string[], options: (theia.AuthenticationGetSessionOptions & { createIfNone: true })
        | theia.AuthenticationGetSessionOptions): Promise<theia.AuthenticationSession | undefined> {
        const provider = this.authenticationProviders.get(providerId);
        // const extensionName = requestingExtension.displayName || requestingExtension.name;
        // const extensionId = ExtensionIdentifier.toKey(requestingExtension.identifier);

        if (!provider) {
            return this.proxy.$getSession(providerId, scopes, options);
        }

        const orderedScopes = scopes.sort().join(' ');
        const sessions = (await provider.getSessions()).filter(session => session.scopes.sort().join(' ') === orderedScopes);

        if (sessions.length) {
            if (!provider.supportsMultipleAccounts) {
                const session = sessions[0];
                const allowed = await this.proxy.$getSessionsPrompt(providerId, session.account.displayName, provider.displayName, extensionId, extensionName);
                if (allowed) {
                    return session;
                } else {
                    throw new Error('User did not consent to login.');
                }
            }

            // On renderer side, confirm consent, ask user to choose between accounts if multiple sessions are valid
            const selected = await this._proxy.$selectSession(providerId, provider.displayName, extensionId, extensionName, sessions, scopes, !!options.clearSessionPreference);
            return sessions.find(session => session.id === selected.id);
        } else {
            if (options.createIfNone) {
                const isAllowed = await this.proxy.$loginPrompt(provider.displayName, extensionName);
                if (!isAllowed) {
                    throw new Error('User did not consent to login.');
                }

                const session = await provider.login(scopes);
                await this._proxy.$setTrustedExtension(providerId, session.account.displayName, extensionId, extensionName);
                return session;
            } else {
                await this._proxy.$requestNewSession(providerId, scopes, extensionId, extensionName);
                return undefined;
            }
        }
    }

    $getSessions(id: string): Promise<AuthenticationSession[]> {
        return Promise.resolve([]);
    }

    async $login(id: string, scopes: string[]): Promise<AuthenticationSession> {
        return new class implements AuthenticationSession {
            accessToken: string;
            account: { displayName: string; id: string };
            id: string;
            scopes: string[];
        };
    }

    $logout(id: string, sessionId: string): Promise<void> {
        return Promise.resolve(undefined);
    }
}
