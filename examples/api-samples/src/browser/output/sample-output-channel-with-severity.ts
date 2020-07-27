/********************************************************************************
 * Copyright (c) 2020 SAP SE or an SAP affiliate company and others.
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
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable, interfaces } from 'inversify';
import { OutputChannelManager, OutputChannelSeverity } from '@theia/output/lib/common/output-channel';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { OutputCommands } from '@theia/output/lib/browser/output-commands';

const SAMPLE_CHANNEL_NAME = 'API Sample: my test channel';

@injectable()
export class SampleOutputChannelWithSeverity
    implements FrontendApplicationContribution {
    @inject(OutputChannelManager)
    protected readonly outputChannelManager: OutputChannelManager;
    public onStart(): void {
        const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
        channel.appendLine('hello info1'); // showed without color
        channel.appendLine('hello info2', OutputChannelSeverity.Info);
        channel.appendLine('hello error', OutputChannelSeverity.Error);
        channel.appendLine('hello warning', OutputChannelSeverity.Warning);
        channel.append('inlineInfo1 ');
        channel.append('inlineWarning ', OutputChannelSeverity.Warning);
        channel.append('inlineError ', OutputChannelSeverity.Error);
        channel.append('inlineInfo2\n', OutputChannelSeverity.Info);
    }
}
@injectable()
export class SampleOutputChannelCommandContribution implements CommandContribution {
    @inject(OutputChannelManager)
    private readonly outputChannelManager: OutputChannelManager;
    registerCommands(r: CommandRegistry): void {
        r.registerCommand({ id: 'sample-output:show-command:preserve-focus', label: 'Show channel (command, explicit, preserve-focus)', category: 'API-Samples' }, {
            execute: () => {
                const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
                channel.appendLine('Show channel (command, explicit, preserve-focus) -> the Output widget should be revealed but must not be active.');
                r.executeCommand(OutputCommands.SHOW.id, { name: SAMPLE_CHANNEL_NAME, options: { preserveFocus: true } });
            }
        });
        r.registerCommand({ id: 'sample-output:show-command:preserve-focus-implicit', label: 'Show channel (command, implicit, no preserve-focus)', category: 'API-Samples' }, {
            execute: () => {
                const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
                channel.appendLine('Show channel (command, implicit, no preserve-focus) -> the Output widget should be active.');
                r.executeCommand(OutputCommands.SHOW.id, { name: SAMPLE_CHANNEL_NAME });
            }
        });
        r.registerCommand({ id: 'sample-output:show-command:no-preserve-focus-explicit', label: 'Show channel (command, explicit, no preserve-focus)', category: 'API-Samples' }, {
            execute: () => {
                const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
                channel.appendLine('Show channel (command, explicit, no preserve-focus) -> the Output widget should be active.');
                r.executeCommand(OutputCommands.SHOW.id, { name: SAMPLE_CHANNEL_NAME, options: { preserveFocus: false } });
            }
        });

        r.registerCommand({ id: 'sample-output:show-api:preserve-focus', label: 'Show channel (API, explicit, preserve-focus)', category: 'API-Samples' }, {
            execute: () => {
                const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
                channel.appendLine('Show channel (API, explicit, preserve-focus) -> the Output widget should be revealed but must not be active.');
                channel.show({ preserveFocus: true });
            }
        });
        r.registerCommand({ id: 'sample-output:show-api:preserve-focus-implicit', label: 'Show channel (API, implicit, no preserve-focus)', category: 'API-Samples' }, {
            execute: () => {
                const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
                channel.appendLine('Show channel (API, implicit, no preserve-focus) -> the Output widget should be active.');
                channel.show();
            }
        });
        r.registerCommand({ id: 'sample-output:show-api:no-preserve-focus-explicit', label: 'Show channel (API, explicit, no preserve-focus)', category: 'API-Samples' }, {
            execute: () => {
                const channel = this.outputChannelManager.getChannel(SAMPLE_CHANNEL_NAME);
                channel.appendLine('Show channel (API, explicit, no preserve-focus) -> the Output widget should be active.');
                channel.show({ preserveFocus: false });
            }
        });
    }
}
export const bindSampleOutputChannelWithSeverity = (bind: interfaces.Bind) => {
    bind(FrontendApplicationContribution)
        .to(SampleOutputChannelWithSeverity)
        .inSingletonScope();
    bind(CommandContribution)
        .to(SampleOutputChannelCommandContribution)
        .inSingletonScope();
};
