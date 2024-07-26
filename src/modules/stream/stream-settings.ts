import { BxEvent } from "@utils/bx-event";
import { BxIcon } from "@utils/bx-icon";
import { STATES, AppInterface } from "@utils/global";
import { ButtonStyle, CE, createButton, createSvgIcon } from "@utils/html";
import { PrefKey, Preferences, getPref, toPrefElement } from "@utils/preferences";
import { t } from "@utils/translation";
import { ControllerShortcut } from "../controller-shortcut";
import { MkbRemapper } from "../mkb/mkb-remapper";
import { NativeMkbHandler } from "../mkb/native-mkb-handler";
import { SoundShortcut } from "../shortcuts/shortcut-sound";
import { TouchController } from "../touch-controller";
import { VibrationManager } from "../vibration-manager";
import { StreamStats } from "./stream-stats";
import { BxSelectElement } from "@/web-components/bx-select";
import { onChangeVideoPlayerType, updateVideoPlayer } from "./stream-settings-utils";
import { GamepadKey } from "@/enums/mkb";
import { EmulatedMkbHandler } from "../mkb/mkb-handler";

enum NavigationDirection {
    UP = 1,
    RIGHT,
    DOWN,
    LEFT,
}

enum FocusContainer {
    OUTSIDE,
    TABS,
    SETTINGS,
}

export class StreamSettings {
    private static instance: StreamSettings;

    public static getInstance(): StreamSettings {
        if (!StreamSettings.instance) {
            StreamSettings.instance = new StreamSettings();
        }

        return StreamSettings.instance;
    }

    static readonly MAIN_CLASS = 'bx-stream-settings-dialog';

    private static readonly GAMEPAD_POLLING_INTERVAL = 50;
    private static readonly GAMEPAD_KEYS = [
        GamepadKey.UP,
        GamepadKey.DOWN,
        GamepadKey.LEFT,
        GamepadKey.RIGHT,
        GamepadKey.A,
        GamepadKey.B,
        GamepadKey.LB,
        GamepadKey.RB,
    ];

    private static readonly GAMEPAD_DIRECTION_MAP = {
        [GamepadKey.UP]: NavigationDirection.UP,
        [GamepadKey.DOWN]: NavigationDirection.DOWN,
        [GamepadKey.LEFT]: NavigationDirection.LEFT,
        [GamepadKey.RIGHT]: NavigationDirection.RIGHT,

        [GamepadKey.LS_UP]: NavigationDirection.UP,
        [GamepadKey.LS_DOWN]: NavigationDirection.DOWN,
        [GamepadKey.LS_LEFT]: NavigationDirection.LEFT,
        [GamepadKey.LS_RIGHT]: NavigationDirection.RIGHT,
    };

    private gamepadPollingIntervalId: number | null = null;
    private gamepadLastButtons: Array<GamepadKey | null> = [];

    private $container: HTMLElement | undefined;
    private $tabs: HTMLElement | undefined;
    private $settings: HTMLElement | undefined;
    private $overlay: HTMLElement | undefined;

    readonly SETTINGS_UI = [{
        icon: BxIcon.DISPLAY,
        group: 'stream',
        items: [{
            group: 'audio',
            label: t('audio'),
            help_url: 'https://better-xcloud.github.io/ingame-features/#audio',
            items: [{
                pref: PrefKey.AUDIO_VOLUME,
                onChange: (e: any, value: number) => {
                    SoundShortcut.setGainNodeVolume(value);
                },
                params: {
                    disabled: !getPref(PrefKey.AUDIO_ENABLE_VOLUME_CONTROL),
                },
                onMounted: ($elm: HTMLElement) => {
                    const $range = $elm.querySelector('input[type=range') as HTMLInputElement;
                    window.addEventListener(BxEvent.GAINNODE_VOLUME_CHANGED, e => {
                        $range.value = (e as any).volume;
                        BxEvent.dispatch($range, 'input', {
                            ignoreOnChange: true,
                        });
                    });
                },
            }],
        }, {
            group: 'video',
            label: t('video'),
            help_url: 'https://better-xcloud.github.io/ingame-features/#video',
            items: [{
                pref: PrefKey.VIDEO_PLAYER_TYPE,
                onChange: onChangeVideoPlayerType,
            }, {
                pref: PrefKey.VIDEO_RATIO,
                onChange: updateVideoPlayer,
            }, {
                pref: PrefKey.VIDEO_PROCESSING,
                onChange: updateVideoPlayer,
            }, {
                pref: PrefKey.VIDEO_POWER_PREFERENCE,
                onChange: () => {
                    const streamPlayer = STATES.currentStream.streamPlayer;
                    if (!streamPlayer) {
                        return;
                    }

                    streamPlayer.reloadPlayer();
                    updateVideoPlayer();
                },
            }, {
                pref: PrefKey.VIDEO_SHARPNESS,
                onChange: updateVideoPlayer,
            }, {
                pref: PrefKey.VIDEO_SATURATION,
                onChange: updateVideoPlayer,
            }, {
                pref: PrefKey.VIDEO_CONTRAST,
                onChange: updateVideoPlayer,
            }, {
                pref: PrefKey.VIDEO_BRIGHTNESS,
                onChange: updateVideoPlayer,
            }],
        }],
        }, {
            icon: BxIcon.CONTROLLER,
            group: 'controller',
            items: [{
                group: 'controller',
                label: t('controller'),
                help_url: 'https://better-xcloud.github.io/ingame-features/#controller',
                items: [{
                    pref: PrefKey.CONTROLLER_ENABLE_VIBRATION,
                    unsupported: !VibrationManager.supportControllerVibration(),
                    onChange: () => VibrationManager.updateGlobalVars(),
                }, {
                    pref: PrefKey.CONTROLLER_DEVICE_VIBRATION,
                    unsupported: !VibrationManager.supportDeviceVibration(),
                    onChange: () => VibrationManager.updateGlobalVars(),
                }, (VibrationManager.supportControllerVibration() || VibrationManager.supportDeviceVibration()) && {
                    pref: PrefKey.CONTROLLER_VIBRATION_INTENSITY,
                    unsupported: !VibrationManager.supportDeviceVibration(),
                    onChange: () => VibrationManager.updateGlobalVars(),
                }],
            },

            STATES.userAgent.capabilities.touch && {
                group: 'touch-controller',
                label: t('touch-controller'),
                items: [{
                    label: t('layout'),
                    content: CE('select', {disabled: true}, CE('option', {}, t('default'))),
                    onMounted: ($elm: HTMLSelectElement) => {
                        $elm.addEventListener('change', e => {
                            TouchController.loadCustomLayout(STATES.currentStream?.xboxTitleId!, $elm.value, 1000);
                        });

                        window.addEventListener(BxEvent.CUSTOM_TOUCH_LAYOUTS_LOADED, e => {
                            const data = (e as any).data;

                            if (STATES.currentStream?.xboxTitleId && ($elm as any).xboxTitleId === STATES.currentStream?.xboxTitleId) {
                                $elm.dispatchEvent(new Event('change'));
                                return;
                            }

                            ($elm as any).xboxTitleId = STATES.currentStream?.xboxTitleId;

                            // Clear options
                            while ($elm.firstChild) {
                                $elm.removeChild($elm.firstChild);
                            }

                            $elm.disabled = !data;
                            if (!data) {
                                $elm.appendChild(CE('option', {value: ''}, t('default')));
                                $elm.value = '';
                                $elm.dispatchEvent(new Event('change'));
                                return;
                            }

                            // Add options
                            const $fragment = document.createDocumentFragment();
                            for (const key in data.layouts) {
                                const layout = data.layouts[key];

                                let name;
                                if (layout.author) {
                                    name = `${layout.name} (${layout.author})`;
                                } else {
                                    name = layout.name;
                                }

                                const $option = CE('option', {value: key}, name);
                                $fragment.appendChild($option);
                            }

                            $elm.appendChild($fragment);
                            $elm.value = data.default_layout;
                            $elm.dispatchEvent(new Event('change'));
                        });
                    },
                }],
            }],
        },

        getPref(PrefKey.MKB_ENABLED) && {
            icon: BxIcon.VIRTUAL_CONTROLLER,
            group: 'mkb',
            items: [{
                group: 'mkb',
                label: t('virtual-controller'),
                help_url: 'https://better-xcloud.github.io/mouse-and-keyboard/',
                content: MkbRemapper.INSTANCE.render(),
            }],
        },

        AppInterface && getPref(PrefKey.NATIVE_MKB_ENABLED) === 'on' && {
            icon: BxIcon.NATIVE_MKB,
            group: 'native-mkb',
            items: [{
                group: 'native-mkb',
                label: t('native-mkb'),
                items: [{
                    pref: PrefKey.NATIVE_MKB_SCROLL_VERTICAL_SENSITIVITY,
                    onChange: (e: any, value: number) => {
                        NativeMkbHandler.getInstance().setVerticalScrollMultiplier(value / 100);
                    },
                }, {
                    pref: PrefKey.NATIVE_MKB_SCROLL_HORIZONTAL_SENSITIVITY,
                    onChange: (e: any, value: number) => {
                        NativeMkbHandler.getInstance().setHorizontalScrollMultiplier(value / 100);
                    },
                }],
            }],
        }, {
            icon: BxIcon.COMMAND,
            group: 'shortcuts',
            items: [{
                group: 'shortcuts_controller',
                label: t('controller-shortcuts'),
                content: ControllerShortcut.renderSettings(),
            }],
        }, {
            icon: BxIcon.STREAM_STATS,
            group: 'stats',
            items: [{
                group: 'stats',
                label: t('stream-stats'),
                help_url: 'https://better-xcloud.github.io/stream-stats/',
                items: [{
                        pref: PrefKey.STATS_SHOW_WHEN_PLAYING,
                    }, {
                        pref: PrefKey.STATS_QUICK_GLANCE,
                        onChange: (e: InputEvent) => {
                            const streamStats = StreamStats.getInstance();
                            (e.target! as HTMLInputElement).checked ? streamStats.quickGlanceSetup() : streamStats.quickGlanceStop();
                        },
                    }, {
                        pref: PrefKey.STATS_ITEMS,
                        onChange: StreamStats.refreshStyles,
                    }, {
                        pref: PrefKey.STATS_POSITION,
                        onChange: StreamStats.refreshStyles,
                    }, {
                        pref: PrefKey.STATS_TEXT_SIZE,
                        onChange: StreamStats.refreshStyles,
                    }, {
                        pref: PrefKey.STATS_OPACITY,
                        onChange: StreamStats.refreshStyles,
                    }, {
                        pref: PrefKey.STATS_TRANSPARENT,
                        onChange: StreamStats.refreshStyles,
                    }, {
                        pref: PrefKey.STATS_CONDITIONAL_FORMATTING,
                        onChange: StreamStats.refreshStyles,
                    },
                ],
            }],
        },
    ];

    constructor() {
        this.#setupDialog();

        // Hide dialog when the Guide menu is shown
        window.addEventListener(BxEvent.XCLOUD_GUIDE_MENU_SHOWN, e => this.hide());
    }

    isShowing() {
        return this.$container && !this.$container.classList.contains('bx-gone');
    }

    show(tabId?: string) {
        const $container = this.$container!;
        // Select tab
        if (tabId) {
            const $tab = $container.querySelector(`.bx-stream-settings-tabs svg[data-tab-group=${tabId}]`);
            $tab && $tab.dispatchEvent(new Event('click'));
        }

        // Show overlay
        this.$overlay!.classList.remove('bx-gone');
        this.$overlay!.dataset.isPlaying = STATES.isPlaying.toString();

        // Show dialog
        $container.classList.remove('bx-gone');
        // Lock scroll bar
        document.body.classList.add('bx-no-scroll');

        // Focus the first visible setting
        this.#focusDirection(NavigationDirection.DOWN);

        // Add event listeners
        $container.addEventListener('keydown', this);

        // Start gamepad polling
        this.#startGamepadPolling();

        // Disable xCloud's navigation polling
        (window as any).BX_EXPOSED.disableGamepadPolling = true;

        BxEvent.dispatch(window, BxEvent.XCLOUD_DIALOG_SHOWN);

        // Update video's settings
        onChangeVideoPlayerType();
    }

    hide() {
        // Hide overlay
        this.$overlay!.classList.add('bx-gone');
        // Hide dialog
        this.$container!.classList.add('bx-gone');
        // Show scroll bar
        document.body.classList.remove('bx-no-scroll');

        // Remove event listeners
        this.$container!.removeEventListener('keydown', this);

        // Stop gamepad polling();
        this.#stopGamepadPolling();

        // Enable xCloud's navigation polling
        (window as any).BX_EXPOSED.disableGamepadPolling = false;

        BxEvent.dispatch(window, BxEvent.XCLOUD_DIALOG_DISMISSED);
    }

    #focusCurrentTab() {
        const $currentTab = this.$tabs!.querySelector('.bx-active') as HTMLElement;
        $currentTab && $currentTab.focus();
    }

    #pollGamepad() {
        const gamepads = window.navigator.getGamepads();

        let direction: NavigationDirection | null = null;
        for (const gamepad of gamepads) {
            if (!gamepad || !gamepad.connected) {
                continue;
            }

            // Ignore virtual controller
            if (gamepad.id === EmulatedMkbHandler.VIRTUAL_GAMEPAD_ID) {
                continue;
            }

            const axes = gamepad.axes;
            const buttons = gamepad.buttons;

            let lastButton = this.gamepadLastButtons[gamepad.index];
            let pressedButton: GamepadKey | null = null;
            let holdingButton: GamepadKey | null = null;

            for (const key of StreamSettings.GAMEPAD_KEYS) {
                if (typeof lastButton === 'number') {
                    // Key released
                    if (lastButton === key && !buttons[key].pressed) {
                        pressedButton = key;
                        break;
                    }
                } else if (buttons[key].pressed) {
                    // Key pressed
                    holdingButton = key;
                    break;
                }
            }

            if (holdingButton === null && pressedButton === null && axes && axes.length >= 2) {
                // Check sticks
                // LEFT left-right, LEFT up-down

                if (typeof lastButton === 'number') {
                    const releasedHorizontal = Math.abs(axes[0]) < 0.1 && (lastButton === GamepadKey.LS_LEFT || lastButton === GamepadKey.LS_RIGHT);
                    const releasedVertical = Math.abs(axes[1]) < 0.1 && (lastButton === GamepadKey.LS_UP || lastButton === GamepadKey.LS_DOWN);

                    if (releasedHorizontal || releasedVertical) {
                        pressedButton = lastButton;
                    }
                } else {
                    if (axes[0] < -0.5) {
                        holdingButton = GamepadKey.LS_LEFT;
                    } else if (axes[0] > 0.5) {
                        holdingButton = GamepadKey.LS_RIGHT;
                    } else if (axes[1] < -0.5) {
                        holdingButton = GamepadKey.LS_UP;
                    } else if (axes[1] > 0.5) {
                        holdingButton = GamepadKey.LS_DOWN;
                    }
                }
            }

            if (holdingButton !== null) {
                this.gamepadLastButtons[gamepad.index] = holdingButton;
            }

            if (pressedButton === null) {
                continue;
            }

            this.gamepadLastButtons[gamepad.index] = null;

            if (pressedButton === GamepadKey.A) {
                document.activeElement && document.activeElement.dispatchEvent(new MouseEvent('click'));
                return;
            } else if (pressedButton === GamepadKey.B) {
                this.hide();
                return;
            } else if (pressedButton === GamepadKey.LB || pressedButton === GamepadKey.RB) {
                // Focus setting tabs
                this.#focusCurrentTab();
                return;
            }

            direction = StreamSettings.GAMEPAD_DIRECTION_MAP[pressedButton as keyof typeof StreamSettings.GAMEPAD_DIRECTION_MAP];
            if (direction) {
                let handled = false;
                if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range') {
                    const $range = document.activeElement;
                    if (direction === NavigationDirection.LEFT || direction === NavigationDirection.RIGHT) {
                        $range.value = (parseInt($range.value) + parseInt($range.step) * (direction === NavigationDirection.LEFT ? -1 : 1)).toString();
                        $range.dispatchEvent(new InputEvent('input'));
                        handled = true;
                    }
                }

                if (!handled) {
                    this.#focusDirection(direction);
                }
            }

            return;
        }
    }

    #startGamepadPolling() {
        this.#stopGamepadPolling();

        this.gamepadPollingIntervalId = window.setInterval(this.#pollGamepad.bind(this), StreamSettings.GAMEPAD_POLLING_INTERVAL);
    }

    #stopGamepadPolling() {
        this.gamepadLastButtons = [];

        this.gamepadPollingIntervalId && window.clearInterval(this.gamepadPollingIntervalId);
        this.gamepadPollingIntervalId = null;
    }

    #handleTabsNavigation($focusing: HTMLElement, direction: NavigationDirection) {
        if (direction === NavigationDirection.UP || direction === NavigationDirection.DOWN) {
            let $sibling = $focusing;
            const siblingProperty = direction === NavigationDirection.UP ? 'previousElementSibling' : 'nextElementSibling';

            while ($sibling[siblingProperty]) {
                $sibling = $sibling[siblingProperty] as HTMLElement;
                $sibling && $sibling.focus();
                return;
            }

            // If it's the first/last item -> loop around
            const pseudo = direction === NavigationDirection.UP ? 'last-of-type' : 'first-of-type';
            const $target = this.$tabs!.querySelector(`svg:not(.bx-gone):${pseudo}`);
            $target && ($target as HTMLElement).focus();
        } else if (direction === NavigationDirection.RIGHT) {
            this.#focusFirstVisibleSetting();
        }
    }

    #handleSettingsNavigation($focusing: HTMLElement, direction: NavigationDirection) {
        // If current element's tabIndex property is not 0
        if ($focusing.tabIndex !== 0) {
            // Find first visible setting
            const $childSetting = $focusing.querySelector('div[data-tab-group]:not(.bx-gone) [tabindex="0"]:not(a)') as HTMLElement;
            if ($childSetting) {
                $childSetting.focus();
                return;
            }
        }

        // Current element is setting -> Find the next one
        // Find parent
        let $parent = $focusing.closest('[data-focus-container]');

        if (!$parent) {
            return;
        }

        // Find sibling setting
        let $sibling = $parent;
        if (direction === NavigationDirection.UP || direction === NavigationDirection.DOWN) {
            const siblingProperty = direction === NavigationDirection.UP ? 'previousElementSibling' : 'nextElementSibling';

            while ($sibling[siblingProperty]) {
                $sibling = $sibling[siblingProperty];
                const $childSetting = $sibling.querySelector('[tabindex="0"]:last-of-type') as HTMLElement;
                if ($childSetting) {
                    $childSetting.focus();

                    // Only stop when it was focused successfully
                    if (document.activeElement === $childSetting) {
                        return;
                    }
                }
            }

            // If it's the first/last item -> loop around
            // TODO: bugged if pseudo is "first-of-type" and the first setting is disabled
            const pseudo = direction === NavigationDirection.UP ? ':last-of-type' : '';
            const $target = this.$settings!.querySelector(`div[data-tab-group]:not(.bx-gone) div[data-focus-container]:not(.bx-gone)${pseudo} [tabindex="0"]:not(:disabled):last-of-type`);
            $target && ($target as HTMLElement).focus();
        } else if (direction === NavigationDirection.LEFT || direction === NavigationDirection.RIGHT) {
            // Find all child elements with tabindex
            const children = Array.from($parent.querySelectorAll('[tabindex="0"]'));
            const index = children.indexOf($focusing);
            let nextIndex;
            if (direction === NavigationDirection.LEFT) {
                nextIndex = index - 1;
            } else {
                nextIndex = index + 1;
            }

            nextIndex = Math.max(-1, Math.min(nextIndex, children.length - 1));
            if (nextIndex === -1) {
                // Focus setting tabs
                const $tab = this.$tabs!.querySelector('svg.bx-active') as HTMLElement;
                $tab && $tab.focus();
            } else if (nextIndex !== index) {
                (children[nextIndex] as HTMLElement).focus();
            }
        }
    }

    #focusFirstVisibleSetting() {
        // Focus the first visible tab content
        const $tab = this.$settings!.querySelector('div[data-tab-group]:not(.bx-gone)') as HTMLElement;

        if ($tab) {
            // Focus on the first focusable setting
            const $control = $tab.querySelector('[tabindex="0"]:not(a)') as HTMLElement;
            if ($control) {
                $control.focus();
            } else {
                // Focus tab
                $tab.focus();
            }
        }
    }

    #focusDirection(direction: NavigationDirection) {
        const $tabs = this.$tabs!;
        const $settings = this.$settings!;

        // Get current focused element
        let $focusing = document.activeElement as HTMLElement;

        let focusContainer = FocusContainer.OUTSIDE;
        if ($focusing) {
            if ($settings.contains($focusing)) {
                focusContainer = FocusContainer.SETTINGS;
            } else if ($tabs.contains($focusing)) {
                focusContainer = FocusContainer.TABS;
            }
        }

        // If not focusing any element or the focused element is not inside the dialog
        if (focusContainer === FocusContainer.OUTSIDE) {
            this.#focusFirstVisibleSetting();
            return;
        } else if (focusContainer === FocusContainer.SETTINGS) {
            this.#handleSettingsNavigation($focusing, direction);
        } else if (focusContainer === FocusContainer.TABS) {
            this.#handleTabsNavigation($focusing, direction);
        }
    }

    handleEvent(event: Event) {
        switch (event.type) {
            case 'keydown':
                const $target = event.target as HTMLElement;
                const keyboardEvent = event as KeyboardEvent;
                const keyCode = keyboardEvent.code || keyboardEvent.key;

                let handled = false;

                if (keyCode === 'ArrowUp' || keyCode === 'ArrowDown') {
                    handled = true;
                    this.#focusDirection(keyCode === 'ArrowUp' ? NavigationDirection.UP : NavigationDirection.DOWN);
                } else if (keyCode === 'ArrowLeft' || keyCode === 'ArrowRight') {
                    if (($target as any).type !== 'range') {
                        handled = true;
                        this.#focusDirection(keyCode === 'ArrowLeft' ? NavigationDirection.LEFT : NavigationDirection.RIGHT);
                    }
                } else if (keyCode === 'Enter' || keyCode === 'Space') {
                    if ($target instanceof SVGElement) {
                        handled = true;
                        $target.dispatchEvent(new Event('click'));
                    }
                } else if (keyCode === 'Tab') {
                    handled = true;
                    this.#focusCurrentTab();
                } else if (keyCode === 'Escape') {
                    handled = true;
                    this.hide();
                }

                if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                break;
        }
    }

    #setupDialog() {
        let $tabs: HTMLElement;
        let $settings: HTMLElement;

        const $overlay = CE('div', {class: 'bx-stream-settings-overlay bx-gone'});
        this.$overlay = $overlay;

        const $container = CE('div', {class: StreamSettings.MAIN_CLASS + ' bx-gone'},
                $tabs = CE('div', {class: 'bx-stream-settings-tabs'}),
                $settings = CE('div', {
                    class: 'bx-stream-settings-tab-contents',
                    tabindex: 10,
                }),
            );

        this.$container = $container;
        this.$tabs = $tabs;
        this.$settings = $settings;

        // Close dialog when clicking on the overlay
        $overlay.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
        });

        // Close dialog when not clicking on any child elements in the dialog
        $container.addEventListener('click', e => {
            if (e.target === $container) {
                e.preventDefault();
                e.stopPropagation();
                this.hide();
            }
        });

        for (const settingTab of this.SETTINGS_UI) {
            if (!settingTab) {
                continue;
            }

            const $svg = createSvgIcon(settingTab.icon);
            $svg.tabIndex = 0;

            $svg.addEventListener('click', e => {
                // Switch tab
                for (const $child of Array.from($settings.children)) {
                    if ($child.getAttribute('data-tab-group') === settingTab.group) {
                        $child.classList.remove('bx-gone');
                    } else {
                        $child.classList.add('bx-gone');
                    }
                }

                // Highlight current tab button
                for (const $child of Array.from($tabs.children)) {
                    $child.classList.remove('bx-active');
                }

                $svg.classList.add('bx-active');
            });

            $tabs.appendChild($svg);

            const $group = CE('div', {'data-tab-group': settingTab.group, 'class': 'bx-gone'});

            for (const settingGroup of settingTab.items) {
                if (!settingGroup) {
                    continue;
                }

                $group.appendChild(CE('h2', {'data-focus-container': 'true'},
                        CE('span', {}, settingGroup.label),
                        settingGroup.help_url && createButton({
                                icon: BxIcon.QUESTION,
                                style: ButtonStyle.GHOST | ButtonStyle.FOCUSABLE,
                                url: settingGroup.help_url,
                                title: t('help'),
                                tabIndex: 0,
                            }),
                    ));
                if (settingGroup.note) {
                    if (typeof settingGroup.note === 'string') {
                        settingGroup.note = document.createTextNode(settingGroup.note);
                    }
                    $group.appendChild(settingGroup.note);
                }

                if (settingGroup.content) {
                    $group.appendChild(settingGroup.content);
                    continue;
                }

                if (!settingGroup.items) {
                    settingGroup.items = [];
                }

                for (const setting of settingGroup.items) {
                    if (!setting) {
                        continue;
                    }

                    const pref = setting.pref;

                    let $control;
                    if (setting.content) {
                        $control = setting.content;
                    } else if (!setting.unsupported) {
                        $control = toPrefElement(pref, setting.onChange, setting.params);

                        // Replace <select> with controller-friendly one
                        if ($control instanceof HTMLSelectElement && getPref(PrefKey.UI_CONTROLLER_FRIENDLY)) {
                            $control = BxSelectElement.wrap($control);
                        }
                    }

                    const label = Preferences.SETTINGS[pref as PrefKey]?.label || setting.label;
                    const note = Preferences.SETTINGS[pref as PrefKey]?.note || setting.note;

                    const $content = CE('div', {
                        class: 'bx-stream-settings-row',
                        'data-type': settingGroup.group,
                        'data-focus-container': 'true',
                    },
                        CE('label', {for: `bx_setting_${pref}`},
                            label,
                            note && CE('div', {'class': 'bx-stream-settings-dialog-note'}, note),
                            setting.unsupported && CE('div', {'class': 'bx-stream-settings-dialog-note'}, t('browser-unsupported-feature')),
                        ),
                        !setting.unsupported && $control,
                    );

                    $group.appendChild($content);

                    setting.onMounted && setting.onMounted($control);
                }
            }

            $settings.appendChild($group);
        }

        // Select first tab
        $tabs.firstElementChild!.dispatchEvent(new Event('click'));

        document.documentElement.appendChild($overlay);
        document.documentElement.appendChild($container);
    }
}