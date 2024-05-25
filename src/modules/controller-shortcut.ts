import { Screenshot } from "@utils/screenshot";
import { GamepadKey } from "./mkb/definitions";
import { PrompFont } from "@utils/prompt-font";
import { CE } from "@utils/html";
import { t } from "@utils/translation";
import { MkbHandler } from "./mkb/mkb-handler";
import { StreamStats } from "./stream/stream-stats";
import { MicrophoneShortcut } from "./shortcuts/shortcut-microphone";
import { StreamUiShortcut } from "./shortcuts/shortcut-stream-ui";
import { PrefKey, getPref } from "@utils/preferences";
import { SoundShortcut } from "./shortcuts/shortcut-sound";
import { BxEvent } from "@/utils/bx-event";

enum ShortcutAction {
    STREAM_SCREENSHOT_CAPTURE = 'stream-screenshot-capture',

    STREAM_MENU_TOGGLE = 'stream-menu-toggle',
    STREAM_STATS_TOGGLE = 'stream-stats-toggle',
    STREAM_SOUND_TOGGLE = 'stream-sound-toggle',
    STREAM_MICROPHONE_TOGGLE = 'stream-microphone-toggle',

    STREAM_VOLUME_INC = 'stream-volume-inc',
    STREAM_VOLUME_DEC = 'stream-volume-dec',

    DEVICE_VOLUME_INC = 'device-volume-inc',
    DEVICE_VOLUME_DEC = 'device-volume-dec',

    SCREEN_BRIGHTNESS_INC = 'screen-brightness-inc',
    SCREEN_BRIGHTNESS_DEC = 'screen-brightness-dec',
}

export class ControllerShortcut {
    static readonly #STORAGE_KEY = 'better_xcloud_controller_shortcuts';

    static #buttonsCache: {[key: string]: boolean[]} = {};
    static #buttonsStatus: {[key: string]: boolean[]} = {};

    static #$selectProfile: HTMLSelectElement;
    static #$selectActions: Partial<{[key in GamepadKey]: HTMLSelectElement}> = {};
    static #$container: HTMLElement;

    static #ACTIONS: {[key: string]: (ShortcutAction | null)[]} = {};

    static reset(index: number) {
        ControllerShortcut.#buttonsCache[index] = [];
        ControllerShortcut.#buttonsStatus[index] = [];
    }

    static handle(gamepad: Gamepad): boolean {
        const gamepadIndex = gamepad.index;
        const actions = ControllerShortcut.#ACTIONS[gamepad.id];
        if (!actions) {
            return false;
        }

        // Move the buttons status from the previous frame to the cache
        ControllerShortcut.#buttonsCache[gamepadIndex] = ControllerShortcut.#buttonsStatus[gamepadIndex].slice(0);
        // Clear the buttons status
        ControllerShortcut.#buttonsStatus[gamepadIndex] = [];

        const pressed: boolean[] = [];
        let otherButtonPressed = false;

        gamepad.buttons.forEach((button, index) => {
            // Only add the newly pressed button to the array (holding doesn't count)
            if (button.pressed && index !== GamepadKey.HOME) {
                otherButtonPressed = true;
                pressed[index] = true;

                // If this is newly pressed button > run action
                if (actions[index] && !ControllerShortcut.#buttonsCache[gamepadIndex][index]) {
                    ControllerShortcut.#runAction(actions[index]!);
                }
            }
        });

        ControllerShortcut.#buttonsStatus[gamepadIndex] = pressed;
        return otherButtonPressed;
    }

    static #runAction(action: ShortcutAction) {
        switch (action) {
            case ShortcutAction.STREAM_SCREENSHOT_CAPTURE:
                Screenshot.takeScreenshot();
                break;

            case ShortcutAction.STREAM_STATS_TOGGLE:
                StreamStats.toggle();
                break;

            case ShortcutAction.STREAM_MICROPHONE_TOGGLE:
                MicrophoneShortcut.toggle();
                break;

            case ShortcutAction.STREAM_MENU_TOGGLE:
                StreamUiShortcut.showHideStreamMenu();
                break;

            case ShortcutAction.STREAM_SOUND_TOGGLE:
                SoundShortcut.muteUnmute();
                break;

            case ShortcutAction.STREAM_VOLUME_INC:
                SoundShortcut.adjustGainNodeVolume(10);
                break;

            case ShortcutAction.STREAM_VOLUME_DEC:
                SoundShortcut.adjustGainNodeVolume(-10);
                break;
        }
    }

    static #updateAction(profile: string, button: GamepadKey, action: ShortcutAction | null) {
        if (!(profile in ControllerShortcut.#ACTIONS)) {
            ControllerShortcut.#ACTIONS[profile] = [];
        }

        if (!action) {
            action = null;
        }

        ControllerShortcut.#ACTIONS[profile][button] = action;

        // Remove empty profiles
        for (const key in ControllerShortcut.#ACTIONS) {
            let empty = true;
            for (const value of ControllerShortcut.#ACTIONS[key]) {
                if (!!value) {
                    empty = false;
                    break;
                }
            }

            if (empty) {
                delete ControllerShortcut.#ACTIONS[key];
            }
        }

        // Save to storage
        window.localStorage.setItem(ControllerShortcut.#STORAGE_KEY, JSON.stringify(ControllerShortcut.#ACTIONS));

        console.log(ControllerShortcut.#ACTIONS);
    }

    static #updateProfileList(e?: GamepadEvent) {
        const $select = ControllerShortcut.#$selectProfile;
        const $container = ControllerShortcut.#$container;

        const $fragment = document.createDocumentFragment();

        // Remove old profiles
        while ($select.firstElementChild) {
            $select.firstElementChild.remove();
        }

        const gamepads = navigator.getGamepads();
        let hasGamepad = false;

        for (const gamepad of gamepads) {
            if (!gamepad || !gamepad.connected) {
                continue;
            }

            // Ignore emulated gamepad
            if (gamepad.id === MkbHandler.VIRTUAL_GAMEPAD_ID) {
                continue;
            }

            hasGamepad = true;

            const $option = CE<HTMLOptionElement>('option', {value: gamepad.id}, gamepad.id);
            $fragment.appendChild($option);
        }

        if (hasGamepad) {
            $select.appendChild($fragment);

            $select.selectedIndex = 0;
            $select.dispatchEvent(new Event('change'));
        }

        $container.dataset.hasGamepad = hasGamepad.toString();
    }

    static #switchProfile(profile: string) {
        let actions = ControllerShortcut.#ACTIONS[profile];
        if (!actions) {
            actions = [];
        }

        // Reset selects' values
        let button: any;
        for (button in ControllerShortcut.#$selectActions) {
            const $select = ControllerShortcut.#$selectActions[button as GamepadKey]!;
            $select.value = actions[button] || '';

            BxEvent.dispatch($select, 'change', {
                    ignoreOnChange: true,
                });
        }
    }

    static renderSettings() {
        // Read actions from localStorage
        ControllerShortcut.#ACTIONS = JSON.parse(window.localStorage.getItem(ControllerShortcut.#STORAGE_KEY) || '{}');

        const buttons = {
            [GamepadKey.A]: PrompFont.A,
            [GamepadKey.B]: PrompFont.B,
            [GamepadKey.X]: PrompFont.X,
            [GamepadKey.Y]: PrompFont.Y,

            [GamepadKey.LB]: PrompFont.LB,
            [GamepadKey.RB]: PrompFont.RB,

            [GamepadKey.LT]: PrompFont.LT,
            [GamepadKey.RT]: PrompFont.RT,

            [GamepadKey.SELECT]: PrompFont.SELECT,
            [GamepadKey.START]: PrompFont.START,

            [GamepadKey.UP]: PrompFont.UP,
            [GamepadKey.DOWN]: PrompFont.DOWN,
            [GamepadKey.LEFT]: PrompFont.LEFT,
            [GamepadKey.RIGHT]: PrompFont.RIGHT,
        };

        const actions: {[key: string]: Partial<{[key in ShortcutAction]: string | string[]}>} = {
            /*
            [t('device')]: AppInterface && {
                [ShortcutAction.DEVICE_VOLUME_INC]: [t('device'), t('volume'), t('increase')],
                [ShortcutAction.DEVICE_VOLUME_DEC]: [t('device'), t('volume'), t('decrease')],

                [ShortcutAction.SCREEN_BRIGHTNESS_INC]: [t('screen'), t('brightness'), t('increase')],
                [ShortcutAction.SCREEN_BRIGHTNESS_DEC]: [t('screen'), t('brightness'), t('decrease')],
            },
            */

            [t('stream')]: {
                [ShortcutAction.STREAM_SCREENSHOT_CAPTURE]: t('take-screenshot'),
                [ShortcutAction.STREAM_STATS_TOGGLE]: [t('stats'), t('show-hide')],
                [ShortcutAction.STREAM_MICROPHONE_TOGGLE]: [t('microphone'), t('toggle')],
                [ShortcutAction.STREAM_MENU_TOGGLE]: [t('menu'), t('show')],
                [ShortcutAction.STREAM_SOUND_TOGGLE]: [t('sound'), t('toggle')],
                [ShortcutAction.STREAM_VOLUME_INC]: getPref(PrefKey.AUDIO_ENABLE_VOLUME_CONTROL) && [t('volume'), t('increase')],
                [ShortcutAction.STREAM_VOLUME_DEC]: getPref(PrefKey.AUDIO_ENABLE_VOLUME_CONTROL) && [t('volume'), t('decrease')],
            }
        };

        const $baseSelect = CE<HTMLSelectElement>('select', {autocomplete: 'off'}, CE('option', {value: ''}, '---'));
        for (const groupLabel in actions) {
            const items = actions[groupLabel];
            if (!items) {
                continue;
            }

            const $optGroup = CE<HTMLOptGroupElement>('optgroup', {'label': groupLabel});

            for (const action in items) {
                let label = items[action as keyof typeof items];
                if (!label) {
                    continue;
                }

                if (Array.isArray(label)) {
                    label = label.join(' ❯ ');
                }

                const $option = CE<HTMLOptionElement>('option', {value: action}, label);
                $optGroup.appendChild($option);
            }

            $baseSelect.appendChild($optGroup);
        }

        let $remap: HTMLElement;
        let $selectProfile: HTMLSelectElement;

        const $container = CE('div', {'data-has-gamepad': 'false'},
            CE('div', {},
                CE('p', {'class': 'bx-shortcut-note'}, t('controller-shortcuts-connect-note')),
            ),

            $remap = CE('div', {},
                $selectProfile = CE('select', {'class': 'bx-shortcut-profile', autocomplete: 'off'}),
                CE('p', {'class': 'bx-shortcut-note'},
                    CE('span', {'class': 'bx-prompt'}, PrompFont.HOME),
                    ': ' + t('controller-shortcuts-xbox-note'),
                ),
            ),
        );

        $selectProfile.addEventListener('change', e => {
            ControllerShortcut.#switchProfile($selectProfile.value);
        });

        const onActionChanged = (e: Event) => {
            const $target = e.target as HTMLSelectElement;

            const profile = $selectProfile.value;
            const button: unknown = $target.dataset.button;
            const action = $target.value as ShortcutAction;

            const $fakeSelect = $target.previousElementSibling! as HTMLSelectElement;
            let fakeText = '---';
            if (action) {
                const $selectedOption =  $target.options[$target.selectedIndex];
                const $optGroup = $selectedOption.parentElement as HTMLOptGroupElement;
                fakeText = $optGroup.label + ' ❯ ' + $selectedOption.text;
            }
            ($fakeSelect.firstElementChild as HTMLOptionElement).text = fakeText;

            !(e as any).ignoreOnChange && ControllerShortcut.#updateAction(profile, button as GamepadKey, action);
        };

        let button: keyof typeof buttons;
        // @ts-ignore
        for (button in buttons) {
            const $row = CE('div', {'class': 'bx-shortcut-row'});

            const prompt = buttons[button];
            const $label = CE('label', {'class': 'bx-prompt'}, `${PrompFont.HOME} + ${prompt}`);

            const $div = CE('div', {'class': 'bx-shortcut-actions'});

            const $fakeSelect = CE<HTMLSelectElement>('select', {autocomplete: 'off'},
                CE('option', {}, '---'),
            );
            $div.appendChild($fakeSelect);

            const $select = $baseSelect.cloneNode(true) as HTMLSelectElement;
            $select.dataset.button = button.toString();
            $select.addEventListener('change', onActionChanged);

            ControllerShortcut.#$selectActions[button] = $select;

            $div.appendChild($select);

            $row.appendChild($label);
            $row.appendChild($div);

            $remap.appendChild($row);
        }

        $container.appendChild($remap);

        ControllerShortcut.#$selectProfile = $selectProfile;
        ControllerShortcut.#$container = $container;

        // Detect when gamepad connected/disconnect
        window.addEventListener('gamepadconnected', ControllerShortcut.#updateProfileList);
        window.addEventListener('gamepaddisconnected', ControllerShortcut.#updateProfileList);

        ControllerShortcut.#updateProfileList();

        return $container;
    }
}