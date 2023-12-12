import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Shell from 'gi://Shell';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

let _display = global.display;

let MiniviewIndicator = GObject.registerClass(
class MiniviewIndicator extends PanelMenu.Button {
    _init(miniview) {
        this._miniview = miniview;

        // create menu ui
        super._init(0.5, 'Miniview');
        let box = new St.BoxLayout();
        let icon = new St.Icon({ icon_name: 'emblem-photos-symbolic', style_class: 'system-status-icon emotes-icon'});

        box.add(icon);
        box.add(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.add_child(box);

        // on/off toggle
        this._tsToggle1 = new PopupMenu.PopupSwitchMenuItem(_('Enable Miniview 1'), false, { style_class: 'popup-subtitle-menu-item' });
        this._tsToggle1.connect('toggled', this._onToggled1.bind(this));
        this.menu.addMenuItem(this._tsToggle1);

        this._tsToggle2 = new PopupMenu.PopupSwitchMenuItem(_('Enable Miniview 2'), false, { style_class: 'popup-subtitle-menu-item' });
        this._tsToggle2.connect('toggled', this._onToggled2.bind(this));
        this.menu.addMenuItem(this._tsToggle2);

        // cycling through windows
        this._tsNext1 = new PopupMenu.PopupMenuItem(_('Next Window 1'));
        this._tsNext1.connect('activate', this._onNext1.bind(this));
        this.menu.addMenuItem(this._tsNext1);

        this._tsNext2 = new PopupMenu.PopupMenuItem(_('Next Window 2'));
        this._tsNext2.connect('activate', this._onNext2.bind(this));
        this.menu.addMenuItem(this._tsNext2);

        this._tsPrev1 = new PopupMenu.PopupMenuItem(_('Previous Window 1'));
        this._tsPrev1.connect('activate', this._onPrev1.bind(this));
        this.menu.addMenuItem(this._tsPrev1);

        this._tsPrev2 = new PopupMenu.PopupMenuItem(_('Previous Window 2'));
        this._tsPrev2.connect('activate', this._onPrev2.bind(this));
        this.menu.addMenuItem(this._tsPrev2);

        // reset ephemeral parameters (in case miniview got lost :) )
        this._tsResetMiniview1 = new PopupMenu.PopupMenuItem(_('Reset Miniview 1'));
        this._tsResetMiniview1.connect('activate', this._onResetMiniview1.bind(this));
        this.menu.addMenuItem(this._tsResetMiniview1);

        this._tsResetMiniview2 = new PopupMenu.PopupMenuItem(_('Reset Miniview 2'));
        this._tsResetMiniview2.connect('activate', this._onResetMiniview2.bind(this));
        this.menu.addMenuItem(this._tsResetMiniview2);

        // extension preferences
        this._tsPreferences = new PopupMenu.PopupMenuItem(_('Preferences'));
        this._tsPreferences.connect('activate', () => this._miniview.openPreferences());
        this.menu.addMenuItem(this._tsPreferences);

        // for double click detection
        this._prev_click_time = null;
    }

    _onToggled1() {
        this._miniview._toggleMiniview(1); // Assuming _toggleMiniview method is adapted to handle specific PiP window
    }
    
    _onToggled2() {
        this._miniview._toggleMiniview(2); // Toggle the second PiP window
    }

    _onNext1() {
        this._miniview._goWindowDown(1);
    }
    _onNext2() {
        this._miniview._goWindowDown(2);
    }

    _onPrev1() {
        this._miniview._goWindowUp(1);
    }
    _onPrev2() {
        this._miniview._goWindowUp(2);
    }

    _onResetMiniview1() {
        this._miniview._clone1.user_opacity = 255;
        this._miniview._clone1.opacity = 255;
        this._miniview._clone1.scale_x = 0.2;
        this._miniview._clone1.scale_y = 0.2;
        this._miniview._clone1.x = 100;
        this._miniview._clone1.y = 100;
        this._miniview._clone1.inMove = false;
        this._miniview._clone1.inResize = false;
        this._miniview._clone1.inResizeCtrl = false;
    }
    
    _onResetMiniview2() {
        this._miniview._clone2.user_opacity = 255;
        this._miniview._clone2.opacity = 255;
        this._miniview._clone2.scale_x = 0.2;
        this._miniview._clone2.scale_y = 0.2;
        this._miniview._clone2.x = 100;
        this._miniview._clone2.y = 100;
        this._miniview._clone2.inMove = false;
        this._miniview._clone2.inResize = false;
        this._miniview._clone2.inResizeCtrl = false;
    }
});

let MiniviewClone = GObject.registerClass({
    Signals: {
        'scroll-up': {},
        'scroll-down': {}
    }
}, class MiniviewClone extends Clutter.Actor {
    _init(miniview) {
        this._miniview = miniview;
        this._windowClone = new Clutter.Clone();

        // The MetaShapedTexture that we clone has a size that includes
        // the invisible border; this is inconvenient; rather than trying
        // to compensate all over the place we insert a ClutterGroup into
        // the hierarchy that is sized to only the visible portion.
        super._init({ reactive: true, x: 100, y: 100 });

        // We expect this to be used for all interaction rather than
        // this._windowClone; as the former is reactive and the latter
        // is not, this just works for most cases. However, for DND all
        // actors are picked, so DND operations would operate on the clone.
        // To avoid this, we hide it from pick.
        Shell.util_set_hidden_from_pick(this._windowClone, true);

        this.add_child(this._windowClone);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('button-release-event', this._onButtonRelease.bind(this));
        this.connect('motion-event', this._onMouseMove.bind(this));
        this.connect('scroll-event', this._onScroll.bind(this));
        this.connect('enter-event', this._onMouseEnter.bind(this));
        this.connect('leave-event', this._onMouseLeave.bind(this));

        // interface state
        this.inMove = false;
        this.inResize = false;
        this.inResizeCtrl = false;

        // initial size
        this.scale_x = 0.2;
        this.scale_y = 0.2;
        this.visible = false;

        // opacity values
        this.user_opacity = 255;
    }

    _onButtonPress(actor, event) {
        // only allow one type of action at a time
        if (this.inMove || this.inResize || this.inResizeCtrl) {
            return true;
        }

        let [click_x, click_y] = event.get_coords();
        this.offset_x = click_x - this.x;
        this.offset_y = click_y - this.y;

        let button = event.get_button();
        let state = event.get_state();
        let ctrl = (state & Clutter.ModifierType.CONTROL_MASK) != 0;
        let shift = (state & Clutter.ModifierType.SHIFT_MASK) != 0;

        // alternative scroll
        if (shift) {
            return true;
        }

        if ((button == 1) && (!ctrl)) {
            this.inMove = true;
        } else if ((button == 3) || ((button == 1) && ctrl)) {
            if (button == 3) {
                this.inResize = true;
            } else {
                this.inResizeCtrl = true;
            }

            this.offset_norm = Math.sqrt(Math.pow(this.offset_x,2)
                                        +Math.pow(this.offset_y,2));

            this.orig_scale_x = this.scale_x;
            this.orig_scale_y = this.scale_y;
        }

        return true;
    }

    _onButtonRelease(actor, event) {
        let button = event.get_button();
        let state = event.get_state();
        let shift = (state & Clutter.ModifierType.SHIFT_MASK) != 0;
        let time = event.get_time();

        // detect double click
        let dbtime = Clutter.Settings.get_default().double_click_time;
        let dbclick = (this._prev_click_time != null) && ((time - this._prev_click_time) < dbtime);
        this._prev_click_time = time;

        // alternative scroll
        if (shift) {
            if (button == 1) {
                this.emit('scroll-up');
            } else if (button == 3) {
                this.emit('scroll-down');
            }
            return true;
        }

        if (button == 1) {
            if (this.inMove) {
                this.inMove = false;
            }

            if (this.inResizeCtrl) {
                this.inResizeCtrl = false;
            }

            if (dbclick) {
                Main.activateWindow(this._metaWin);
            }
        } else if (button == 3) {
            if (this.inResize) {
                this.inResize = false;
            }
        }

        return true;
    }

    _onMouseMove(actor, event) {
        if (this.inMove || this.inResize || this.inResizeCtrl) {
            let [pos_x,pos_y] = event.get_coords();

            if (this.inMove) {
                this.x = pos_x - this.offset_x;
                this.y = pos_y - this.offset_y;
            }

            if (this.inResize || this.inResizeCtrl) {
                let new_offset_x = pos_x - this.x;
                let new_offset_y = pos_y - this.y;
                let new_offset_norm =  Math.sqrt(Math.pow(new_offset_x,2)
                                                +Math.pow(new_offset_y,2));

                this.scale_x = this.orig_scale_x*new_offset_norm/this.offset_norm;
                this.scale_y = this.orig_scale_y*new_offset_norm/this.offset_norm;
            }
        }

        return true;
    }

    _onScroll(actor, event) {
        // only allow one type of action at a time
        if (this.inMove || this.inResize || this.inResizeCtrl) {
            return true;
        }

        let direction = event.get_scroll_direction();
        let state = event.get_state();
        let ctrl = (state & Clutter.ModifierType.CONTROL_MASK) != 0;

        if (ctrl) {
            if (direction == Clutter.ScrollDirection.UP) {
                this.user_opacity += 10;
            } else if (direction == Clutter.ScrollDirection.DOWN) {
                this.user_opacity -= 10;
            }

            if (this.user_opacity > 255) {
                this.user_opacity = 255;
            } else if (this.user_opacity < 35) {
                this.user_opacity = 35;
            }

            this.opacity = this.user_opacity;
        } else {
            if (direction == Clutter.ScrollDirection.UP) {
                this.emit('scroll-up');
            } else if (direction == Clutter.ScrollDirection.DOWN) {
                this.emit('scroll-down');
            }
        }
    }

    _onMouseEnter(actor, event) {
        // decrease opacity a little bit
        this.opacity = Math.trunc(this.user_opacity * 0.8);
    }

    _onMouseLeave(actor, event) {
        if (this.inMove) {
            let [pos_x,pos_y] = event.get_coords();
            this.x = pos_x - this.offset_x;
            this.y = pos_y - this.offset_y;
        } else if (this.inResize) {
            this.inResize = false;
        } else if (this.inResizeCtrl) {
            this.inResizeCtrl = false;
        }
        else {
            // set opacity back to user value
            this.opacity = this.user_opacity;
        }
    }

    setSource(win) {
        this._metaWin = win.meta_window;
        this._windowClone.set_source(win);
    }
});

export default class Miniview extends Extension {
    constructor(metadata) {
        super(metadata);

        // session state - ephemeral parameters
        this.state = {
            metaWin: null,
            pos_x: null,
            pos_y: null,
            size_x: null,
            size_y: null,
            opacity: null
        };
    }

    enable() {
        // global.log(`miniview: enable`)

        // panel menu
        this._indicator = new MiniviewIndicator(this);
        Main.panel.addToStatusArea('miniview', this._indicator);

        // the actual window clone actor
        this._clone1 = new MiniviewClone(this);
        this._clone2 = new MiniviewClone(this);

        this._clone1.connect('scroll-up', this._goWindowUp.bind(this));
        this._clone1.connect('scroll-down', this._goWindowDown.bind(this));
        this._clone2.connect('scroll-up', this._goWindowUp.bind(this));
        this._clone2.connect('scroll-down', this._goWindowDown.bind(this));

        // Initialize both MiniviewClone instances
        Main.layoutManager.addChrome(this._clone1);
        Main.layoutManager.addChrome(this._clone2);

        // track windows as they move across monitors or are created/destroyed
        this._windowEnteredMonitorId = _display.connect('window-entered-monitor', this._windowEnteredMonitor.bind(this));
        this._windowLeftMonitorId = _display.connect('window-left-monitor', this._windowLeftMonitor.bind(this));
        this._windowFocusNotifyId = _display.connect('notify::focus-window', this._windowFocusMonitor.bind(this));

        // for tracking across locking/suspending
        this._state = this.state;
        this._stateTimeout = null;

        // for screen hops (which look like leaving one monitor then quickly entering another)
        this._lastIdx = null;
        this._lastTimeout = null;

        // we use this when inserting windows
        this._insertTimeout = null;

        // start out with null window info
        this._winIdx = null;
        this._metaWin = null;

        // assemble window list
        this._populateWindows();

        // this is a hack so we eventually purge the desktop window in ubuntu
        this._populateTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, this._populateWindows.bind(this));

        // get current settings
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', this._settingsChanged.bind(this));
        this._settingsChanged();

        // assign global toggle
        Main.wm.addKeybinding('toggle-miniview', this._settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, this._toggleMiniview.bind(this));

        // implement settings
        this._reflectState();

      // Restore state for clone1
      if (this.state.metaWin1 != null) {
        let idx1 = this.lookupIndex(this.state.metaWin1);
        if (idx1 != -1) {
            this.setIndex(idx1, 1);
        }
        if (this.state.pos_x1 != null) {
            this._clone1.x = this.state.pos_x1;
        }
        if (this.state.pos_y1 != null) {
            this._clone1.y = this.state.pos_y1;
        }
        if (this.state.size_x1 != null) {
            this._clone1.scale_x = this.state.size_x1;
        }
        if (this.state.size_y1 != null) {
            this._clone1.scale_y = this.state.size_y1;
        }
        if (this.state.opacity1 != null) {
            this._clone1.user_opacity = this.state.opacity1;
            this._clone1.opacity = this.state.opacity1;
        }
    }

    // Restore state for clone2
    if (this.state.metaWin2 != null) {
        let idx2 = this.lookupIndex(this.state.metaWin2);
        if (idx2 != -1) {
            this.setIndex(idx2, 2);
        }
        if (this.state.pos_x2 != null) {
            this._clone2.x = this.state.pos_x2;
        }
        if (this.state.pos_y2 != null) {
            this._clone2.y = this.state.pos_y2;
        }
        if (this.state.size_x2 != null) {
            this._clone2.scale_x = this.state.size_x2;
        }
        if (this.state.size_y2 != null) {
            this._clone2.scale_y = this.state.size_y2;
        }
        if (this.state.opacity2 != null) {
            this._clone2.user_opacity = this.state.opacity2;
            this._clone2.opacity = this.state.opacity2;
        }
    }

    }

    disable() {
        // global.log('miniview: disable')

        // Save state for clone1
        this.state.metaWin1 = this._metaWin1; // Assuming _metaWin1 is being set somewhere
        this.state.pos_x1 = this._clone1.x;
        this.state.pos_y1 = this._clone1.y;
        this.state.size_x1 = this._clone1.scale_x;
        this.state.size_y1 = this._clone1.scale_y;
        this.state.opacity1 = this._clone1.user_opacity;

        // Save state for clone2
        this.state.metaWin2 = this._metaWin2; // Assuming _metaWin2 is being set somewhere
        this.state.pos_x2 = this._clone2.x;
        this.state.pos_y2 = this._clone2.y;
        this.state.size_x2 = this._clone2.scale_x;
        this.state.size_y2 = this._clone2.scale_y;
        this.state.opacity2 = this._clone2.user_opacity;

        _display.disconnect(this._windowEnteredMonitorId);
        _display.disconnect(this._windowLeftMonitorId);
        _display.disconnect(this._windowFocusNotifyId);

        this._settings.disconnect(this._settingsChangedId);
        this._settings = null;
        Main.wm.removeKeybinding('toggle-miniview');

        if (this._stateTimeout != null) {
            GLib.Source.remove(this._stateTimeout);
            this._stateTimeout = null;
        }
        if (this._lastTimeout != null) {
            GLib.Source.remove(this._lastTimeout);
            this._lastTimeout = null;
        }
        if (this._insertTimeout != null) {
            GLib.Source.remove(this._insertTimeout);
            this._insertTimeout = null;
        }
        if (this._populateTimeout != null) {
            GLib.Source.remove(this._populateTimeout);
            this._populateTimeout = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
        }

        if (this._clone1) {
            this._clone1.destroy();
        }
        if (this._clone2) {
            this._clone2.destroy();
        }
    }

    lookupIndex(metaWin) {
        for (let i = 0; i < this._windowList.length; i++) {
            if (this._windowList[i] == metaWin) {
                return i;
            }
        }
        return -1;
    }

    setIndex(idx, cloneNumber) {
        // global.log(`miniview: setIndex: index=${idx}, current=${this._winIdx}, total=${this._windowList.length}`);

        if ((idx >= 0) && (idx < this._windowList.length)) {
            this._winIdx = idx;
            this._metaWin = this._windowList[this._winIdx];
            let win = this._metaWin.get_compositor_private();
            let clone = cloneNumber === 1 ? this._clone1 : this._clone2;
            clone.setSource(win);
            
            // necessary to not get baffled by locking shenanigans
            if (this._stateTimeout != null) {
                GLib.Source.remove(this._stateTimeout);
            }
            this._stateTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._state.metaWin = this._metaWin;
                this._stateTimeout = null;
            });
        }
    }

    updateCloneSources() {
        // Check and update the source for clone1
        if (this._metaWin1 && !this._windowList.includes(this._metaWin1)) {
            // The current window for clone1 is no longer available; update it
            let newIndex1 = this.findNextAvailableWindowIndex(this._metaWin1);
            if (newIndex1 !== -1) {
                this.setIndex(newIndex1, 1);
            }
        }

        // Check and update the source for clone2
        if (this._metaWin2 && !this._windowList.includes(this._metaWin2)) {
            // The current window for clone2 is no longer available; update it
            let newIndex2 = this.findNextAvailableWindowIndex(this._metaWin2);
            if (newIndex2 !== -1) {
                this.setIndex(newIndex2, 2);
            }
        }
    }

    findNextAvailableWindowIndex(currentMetaWin) {
        // Find the index of the next available window after the current one
        let currentIndex = this._windowList.indexOf(currentMetaWin);
        if (currentIndex === -1 || currentIndex + 1 >= this._windowList.length) {
            return 0; // If at the end of the list, return to the beginning
        } else {
            return currentIndex + 1; // Return the next window
        }
    }



    _populateWindows() {
        this._windowList = [];
        let baseWindowList = global.get_window_actors();
        for (let i = 0; i < baseWindowList.length; i++) {
            let metaWin = baseWindowList[i].get_meta_window();
            if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
                this._windowList.push(metaWin);
            }
        }

        // not our first rodeo
        if (this._metaWin != null) {
            let idx = this.lookupIndex(this._metaWin);
            if (this._winIdx != idx) {
                this.setIndex(idx);
            }
            this._realizeMiniview();
        }
    }

    _goWindowUp(cloneNumber) {
        let idx = this._winIdx + 1;
        if (idx >= this._windowList.length) {
            idx = 0;
        }
        this.setIndex(idx, cloneNumber);
    }
    
    _goWindowDown(cloneNumber) {
        let idx = this._winIdx - 1;
        if (idx < 0) {
            idx = this._windowList.length - 1;
        }
        this.setIndex(idx, cloneNumber);
    }
    

    _windowEnteredMonitor(metaScreen, monitorIndex, metaWin) {
        if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
            // let title = metaWin.get_title();
            // let index = this._windowList.length;
            // global.log(`miniview: _windowEnteredMonitor: index=${index}, current=${this._winIdx}, total=${this._windowList.length}, title=${title}`);
            this._insertWindow(metaWin);
        }
    }

    _insertWindow(metaWin) {
        let win = metaWin.get_compositor_private();

        if (!win) {
            // Newly-created windows are added to a workspace before the compositor finds out about them...
            this._insertTimeout = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._clone1 && this._clone2 && metaWin.get_compositor_private()) {
                    this._insertWindow(metaWin);
                }
                return false;
            });

            return;
        }

        // window already in the list?
        if (this.lookupIndex(metaWin) !== -1) {
            return;
        }

        // Add to list - possibly in original place in case of cross-monitor dragging
        if (this._lastIdx !== null) {
            this._windowList.splice(this._lastIdx, 0, metaWin);
        } else {
            this._windowList.push(metaWin);
        }

        // Update sources of clones if necessary
        this.updateCloneSources();

        // Clear last index data if used
        if (this._lastIdx !== null) {
            GLib.Source.remove(this._lastTimeout);
            this._lastIdx = null;
            this._lastActive = null;
            this._lastTimeout = null;
        }
    }

    _windowLeftMonitor(metaScreen, monitorIndex, metaWin) {
        if (metaWin.get_window_type() == Meta.WindowType.NORMAL) {
            // let title = metaWin.get_title();
            // let index = this.lookupIndex(metaWin);
            // global.log(`miniview: _windowLeftMonitor   : index=${index}, current=${this._winIdx}, total=${this._windowList.length}, title=${title}`);
            this._removeWindow(metaWin);
        }
    }

    _windowFocusMonitor(display) {
        this._realizeMiniview();
    }

    _removeWindow(metaWin) {
        let index = this.lookupIndex(metaWin);

        // If not in the list, return early
        if (index === -1) {
            return;
        }

        // Remove from the list
        this._windowList.splice(index, 1);

        // Update clone sources as the window list has changed
        this.updateCloneSources();

        // Store the index briefly in case of dragging between monitors
        if (this._lastIdx === null) {
            this._lastIdx = index;
            this._lastTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._lastIdx = null;
                this._lastTimeout = null;
            });
        }
    }


    _realizeMiniview() {
        if (this._showme) {
            let activeWindow = _display.get_focus_window();
            // Logic for PiP window 1
            if (this._windowList.length > 0 && (this._metaWin1 !== activeWindow || !this._hidefoc)) {
                this._clone1.visible = true;
            } else {
                this._clone1.visible = false;
            }
    
            // Logic for PiP window 2
            if (this._windowList.length > 0 && (this._metaWin2 !== activeWindow || !this._hidefoc)) {
                this._clone2.visible = true;
            } else {
                this._clone2.visible = false;
            }
        } else {
            this._clone1.visible = false;
            this._clone2.visible = false;
        }
    }
    

    _reflectState() {
        this._indicator._tsToggle.setToggleState(this._showme);
        // Update visibility and state of each clone based on their respective toggle states
        this._clone1.visible = this._showme1;
        this._clone2.visible = this._showme2;
        this._realizeMiniview();
    }

    _toggleMiniview(cloneNumber) {
        if (cloneNumber === 1) {
            this._showme1 = !this._showme1;
            this._settings.set_boolean('showme1', this._showme1);
        } else if (cloneNumber === 2) {
            this._showme2 = !this._showme2;
            this._settings.set_boolean('showme2', this._showme2);
        }

        this._reflectState();
    }

    _settingsChanged() {
        this._showme = this._settings.get_boolean('showme');
        this._showind = this._settings.get_boolean('showind');
        this._hidefoc = this._settings.get_boolean('hide-on-focus');
        this._reflectState();
    }
}
