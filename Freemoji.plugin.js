@else@*/

module.exports = (() => {
    const config = {
        info: {
            name: 'Freemoji',
            authors: [
                {
                    name: 'Qb',
                    discord_id: '133659541198864384',
                    github_username: 'QbDesu'
                },
                {
                    name: 'An0',
                    github_username: 'An00nymushun'
                }
            ],
            version: '1.5.6',
            description: 'niente nitro? nessun problema :).',
            github: 'https://github.com/QbDesu/BetterDiscordAddons/blob/potato/Plugins/Freemoji',
            github_raw: 'https://raw.githubusercontent.com/QbDesu/BetterDiscordAddons/potato/Plugins/Freemoji/Freemoji.plugin.js'
        },
        changelog: [
            { title: 'Bug Fixes', types: 'fixed', items: ['Fixed Send Directly option not working because of the reworked grayscale removal.'] },
            { title: 'Previous Changes', type: 'changed', items: ['Reworked the way the grayscale removal works so it should now work with any theme.','There is a new size setting for 48px which is the size of regular Discord emoji.','Fixed size setting not working.'] },
        ],
        defaultConfig: [
            {
                type: 'switch',
                id: 'sendDirectly',
                name: 'Send Directly',
                note: 'Send the emoji link in a message directly instead of putting it in the chat box.',
                value: false
            },
            {
                type: 'slider',
                id: 'emojiSize',
                name: 'Emoji Size',
                note: 'The size of the emoji in pixels. 48 is recommended because it is the size of regular Discord emoji.',
                value: 48,
                markers:[32, 40, 48, 60, 64],
                stickToMarkers:true
            },
            {
                type: 'dropdown',
                id: 'removeGrayscale',
                name: 'Remove Grayscale Filter',
                note: 'Remove the grayscale filter on emoji that would normally not be usable.',
                value: 'embedPerms',
                options: [
                    {
                        label: 'Always',
                        value: 'always'
                    },
                    {
                        label: 'With Embed Perms',
                        value: 'embedPerms'
                    },
                    {
                        label: 'Never',
                        value: 'never'
                    }
                ]
            },
            {
                type: 'dropdown',
                id: 'missingEmbedPerms',
                name: 'Missing Embed Perms Behaviour',
                note: 'What should happen if you select an emoji even though you have no embed permissions.',
                value: 'showDialog',
                options: [
                    {
                        label: 'Show Confirmation Dialog',
                        value: 'showDialog'
                    },
                    {
                        label: 'Insert Anyway',
                        value: 'insert'
                    },
                    {
                        label: 'Nothing',
                        value: 'nothing'
                    }
                ]
            },
            {
                type: 'dropdown',
                id: 'unavailable',
                name: 'Allow Unavailable Emoji',
                note: 'Allow using emoji that would normally even be unavailable to Nitro users. For example emoji which became unavailable because a server lost it\'s boost tier.',
                value: 'allow',
                options: [
                    {
                        label: 'Allow',
                        value: 'allow'
                    },
                    {
                        label: 'Show Confirmation Dialog',
                        value: 'showDialog'
                    },
                    {
                        label: 'Don\'t Allow',
                        value: 'off'
                    }
                ]
            },
            {
                type: 'dropdown',
                id: 'external',
                name: 'Allow External Emoji',
                note: 'Allow External Emoji for servers that have them disabled.',
                value: 'off',
                options: [
                    {
                        label: 'Don\'t Allow',
                        value: 'off'
                    },
                    {
                        label: 'Show Confirmation Dialog',
                        value: 'showDialog'
                    },
                    {
                        label: 'Allow',
                        value: 'allow'
                    }
                ]
            }
        ]
    };
    return !global.ZeresPluginLibrary ? class {
        constructor() { this._config = config; }
        load() {
            BdApi.showConfirmationModal('Library plugin is needed', 
                [`The library plugin needed for ${config.info.name} is missing. Please click Download Now to install it.`], {
                confirmText: 'Download',
                cancelText: 'Cancel',
                onConfirm: () => {
                    require('request').get('https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js', async (error, response, body) => {
                        if (error) return require('electron').shell.openExternal('https://betterdiscord.app/Download?id=9');
                        await new Promise(r => require('fs').writeFile(require('path').join(BdApi.Plugins.folder, '0PluginLibrary.plugin.js'), body, r));
                    });
                }
            });
        }
        start() { }
        stop() { }
    }
    : (([Plugin, Api]) => {
        const plugin = (Plugin, Api) => {
            const {
                Patcher,
                WebpackModules,
                Toasts,
                Logger,
                DiscordModules: {
                    Permissions,
                    DiscordPermissions,
                    UserStore,
                    SelectedChannelStore,
                    ChannelStore,
                    DiscordConstants: { 
                        EmojiDisabledReasons,
                        EmojiIntention
                    } 
                }
            } = Api;

            const Emojis = WebpackModules.findByUniqueProperties(['getDisambiguatedEmojiContext','search']);
            const EmojiParser = WebpackModules.findByUniqueProperties(['parse', 'parsePreprocessor', 'unparse']);
            const EmojiPicker = WebpackModules.findByUniqueProperties(['useEmojiSelectHandler']);
            const MessageUtilities = WebpackModules.getByProps("sendMessage");
            const EmojiFilter = WebpackModules.getByProps('getEmojiUnavailableReason');

            const EmojiPickerListRow = WebpackModules.find(m=>m?.default?.displayName=='EmojiPickerListRow');

            const SIZE_REGEX = /([?&]size=)(\d+)/;

            return class Freemoji extends Plugin {
                currentUser = null;

                replaceEmoji(text, emoji) {
                    const emojiString = `<${emoji.animated ? "a" : ""}:${emoji.originalName || emoji.name}:${emoji.id}>`;
                    const emojiURL = this.getEmojiUrl(emoji);
                    return text.replace(emojiString, emojiURL);
                }

                patch() {
                    // make emote pretend locked emoji are unlocked
                    Patcher.after(Emojis, 'search', (_, args, ret) => {
                        ret.unlocked = ret.unlocked.concat(ret.locked);
                        ret.locked.length = [];
                        return ret;
                    });

                    // replace emoji with links in messages
                    Patcher.after(EmojiParser, 'parse', (_, args, ret) => {
                        for(const emoji of ret.invalidEmojis) {
                            ret.content = this.replaceEmoji(ret.content, emoji);
                        }
                        if (this.settings.allowUnavailable) {
                            for(const emoji of ret.validNonShortcutEmojis) {
                                if (!emoji.available) {
                                    ret.content = this.replaceEmoji(ret.content, emoji);
                                }
                            }
                        }
                        if (this.settings.external) {
                            for(const emoji of ret.validNonShortcutEmojis) {
                                if (this.getEmojiUnavailableReason(emoji) === EmojiDisabledReasons.DISALLOW_EXTERNAL) {
                                    ret.content = this.replaceEmoji(ret.content, emoji);
                                }
                            }
                        }
                        return ret;
                    });

                    // override emoji picker to allow selecting emotes
                    Patcher.after(EmojiPicker, 'useEmojiSelectHandler', (_, args, ret) => {
                        const { onSelectEmoji, closePopout, selectedChannel } = args[0];
                        const self = this;

                        return function (data, state) {
                            if (state.toggleFavorite) return ret.apply(this, arguments);

                            const emoji = data.emoji;
                            const isFinalSelection = state.isFinalSelection;

                            if (self.getEmojiUnavailableReason(emoji, selectedChannel) === EmojiDisabledReasons.DISALLOW_EXTERNAL) {
                                if (self.settings.external == 'off') return;

                                if (self.settings.external == 'showDialog') {
                                    BdApi.showConfirmationModal(
                                        "Sending External Emoji", 
                                        [`It looks like you are trying to send an an External Emoji in a server that would normally allow it. Do you still want to send it?`], {
                                        confirmText: "Send External Emoji",
                                        cancelText: "Cancel",
                                        onConfirm: () => {
                                            self.selectEmoji({emoji, isFinalSelection, onSelectEmoji, selectedChannel, closePopout, disabled: true});
                                        }
                                    });
                                    return;
                                }
                                self.selectEmoji({emoji, isFinalSelection, onSelectEmoji, closePopout, selectedChannel, disabled: true});

                            } else if (!emoji.available) {
                                if (self.settings.unavailable == 'off') return;

                                if (self.settings.external == 'showDialog') {
                                    BdApi.showConfirmationModal(
                                        "Sending Unavailable Emoji", 
                                        [`It looks like you are trying to send an an Emoji that would normally even be unavailable to Nitro users. Do you still want to send it?`], {
                                        confirmText: "Send Unavailable Emoji",
                                        cancelText: "Cancel",
                                        onConfirm: () => {
                                            self.selectEmoji({emoji, isFinalSelection, onSelectEmoji, closePopout, selectedChannel, disabled: true});
                                        }
                                    });
                                    return;
                                }
                                self.selectEmoji({emoji, isFinalSelection, onSelectEmoji, closePopout, selectedChannel, disabled: true});
                                
                            } else {
                                self.selectEmoji({emoji, isFinalSelection, onSelectEmoji, closePopout, selectedChannel, disabled: data.isDisabled});
                            }
                        }
                    });

                    Patcher.after(EmojiFilter, 'getEmojiUnavailableReason', (_, [{intention, bypassPatch}], ret) => {
                        if (intention!==EmojiIntention.CHAT || bypassPatch || !this.settings.external) return;
                        return ret===EmojiDisabledReasons.DISALLOW_EXTERNAL ? null : ret;
                    });

                    Patcher.before(EmojiPickerListRow,'default',(_,[{emojiDescriptors}])=>{
                        if (this.settings.removeGrayscale=='never') return;
                        if (this.settings.removeGrayscale!='always' && !this.hasEmbedPerms()) return;
                        emojiDescriptors.filter(e=>e.isDisabled).forEach(e=>{e.isDisabled=false; e.wasDisabled=true;});
                    });
                    Patcher.after(EmojiPickerListRow,'default',(_,[{emojiDescriptors}])=>{
                        emojiDescriptors.filter(e=>e.wasDisabled).forEach(e=>{e.isDisabled=true; delete e.wasDisabled;});
                    });
                }

                selectEmoji({emoji, isFinalSelection, onSelectEmoji, closePopout, selectedChannel, disabled}) {
                    console.log("disabled", disabled)
                    if (disabled) {
                        console.log("disabled")
                        const perms = this.hasEmbedPerms(selectedChannel);
                        if (!perms && this.settings.missingEmbedPerms == 'nothing') return; 
                        if (!perms && this.settings.missingEmbedPerms == 'showDialog') {
                            BdApi.showConfirmationModal(
                                "Missing Image Embed Permissions", 
                                [`It looks like you are trying to send an Emoji using Freemoji but you dont have the permissions to send embeded images in this channel. You can choose to send it anyway but it will only show as a link.`], {
                                confirmText: "Send Anyway",
                                cancelText: "Cancel",
                                onConfirm: () => {
                                    if (this.settings.sendDirectly) {
                                        MessageUtilities.sendMessage(selectedChannel.id, {content: this.getEmojiUrl(emoji)});
                                    } else {
                                        onSelectEmoji(emoji, isFinalSelection);
                                    }
                                }
                            });
                            return;
                        }
                        if (this.settings.sendDirectly) {
                            MessageUtilities.sendMessage(SelectedChannelStore.getChannelId(), {content: this.getEmojiUrl(emoji)});
                        } else {
                            onSelectEmoji(emoji, isFinalSelection);
                        }
                    } else {
                        onSelectEmoji(emoji, isFinalSelection);
                    }
                    
                    if(isFinalSelection) closePopout();
                }

                getEmojiUnavailableReason(emoji, channel, intention) {
                    return EmojiFilter.getEmojiUnavailableReason({
                        channel: channel || ChannelStore.getChannel(SelectedChannelStore.getChannelId()),
                        emoji,
                        intention: EmojiIntention.CHAT || intention,
                        bypassPatch:true
                    })
                }

                getEmojiUrl(emoji) {
                    return emoji.url.includes("size=") ?
                        emoji.url.replace(SIZE_REGEX,`$1${this.settings.emojiSize}`) :
                        `${emoji.url}&size=${this.settings.emojiSize}`;
                }

                hasEmbedPerms(channelParam) {
                    if (!this.currentUser) this.currentUser = UserStore.getCurrentUser();
                    const channel = channelParam || ChannelStore.getChannel(SelectedChannelStore.getChannelId());
                    if (!channel.guild_id) return true;
                    return Permissions.can(DiscordPermissions.EMBED_LINKS, channel, this.currentUser.id)
                }

                cleanup() {
                    Patcher.unpatchAll();
                }

                onStart() {
                    try{
                        this.patch();
                    } catch (e) {
                        Toasts.error(`${config.info.name}: An error occured during intialiation: ${e}`);
                        Logger.error(`Error while patching: ${e}`);
                        console.error(e);
                    }
                }
                
                onStop() {
                    this.cleanup();
                }
            
                getSettingsPanel() { return this.buildSettingsPanel().getElement(); }
            };
        };
        return plugin(Plugin, Api);
    })(global.ZeresPluginLibrary.buildPlugin(config));
})();
/*@end@*/
