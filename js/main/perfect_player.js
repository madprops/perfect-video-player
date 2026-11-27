/*
  Perfect Video Player
  ====================

  A drop-in replacement for the native <video> controls.

  Design goals:
  - A BIG seekbar placed in the MIDDLE of the video, far away from the
    buttons, so trying to press a button never seeks by accident.
  - A big play/pause button on the bottom left.
  - Volume on the bottom right with -4% / +4% buttons, a clickable slider,
    a percentage label, and mouse wheel support.
  - A big, readable "current / duration" label in the middle of the panel.
  - A single click on the video does nothing (no accidental pauses),
    a double click toggles fullscreen.
  - Controls hide 0.5 seconds after the cursor leaves the player,
    or after 2 seconds without cursor movement over the empty video area
    (never while hovering the panel or seekbar).

  Usage:
    <video data-perfect-player src="movie.mp4"></video>
    (auto upgraded on DOMContentLoaded)

    or manually:
    let player = PerfectPlayer.upgrade(document.querySelector(`#my_video`), {volume_step: 5})

  License: MIT
*/

class PerfectPlayer {
  // Default options, any of these can be overridden per player
  static defaults = {
    // Volume change in percent for buttons, wheel and arrow keys
    volume_step: 4,
    // Seconds to skip with the -5s/+5s buttons and left/right arrow keys
    seek_step: 5,
    // Seconds to skip with the -1m/+1m buttons
    seek_step_long: 60,
    // Hide controls this many ms after the cursor leaves the player
    hide_delay_leave: 500,
    // Hide controls this many ms after the cursor stops moving over empty video
    hide_delay_idle: 2000,
    // Remember the volume across page loads with localStorage
    remember_volume: true,
    storage_key: `perfect_player_volume`,
    // Show a small fullscreen button next to play/pause
    fullscreen_button: true,
    // Sparks on the seekbar (automatically off with prefers-reduced-motion)
    particles: true,
    // Keyboard shortcuts while the player is focused
    keyboard: true,
  }

  // Every player created so far
  static instances = []

  // Maximum sparks alive at the same time per player (keeps it cheap)
  static max_sparks = 36

  // Inline SVG icons, they inherit color through currentColor
  static icons = {
    play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24"><rect x="5.5" y="4" width="4.6" height="16" rx="1.2"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.2"/></svg>`,
    replay: `<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H4.5A7.5 7.5 0 1 0 12 5.5z"/></svg>`,
    rewind: `<svg viewBox="0 0 24 24"><path d="M11.6 17.5V6.5a.8.8 0 0 0-1.3-.62l-6.8 5.5a.8.8 0 0 0 0 1.24l6.8 5.5a.8.8 0 0 0 1.3-.62zm9.4 0V6.5a.8.8 0 0 0-1.3-.62l-6.8 5.5a.8.8 0 0 0 0 1.24l6.8 5.5a.8.8 0 0 0 1.3-.62z"/></svg>`,
    forward: `<svg viewBox="0 0 24 24"><path d="M12.4 6.5v11a.8.8 0 0 0 1.3.62l6.8-5.5a.8.8 0 0 0 0-1.24l-6.8-5.5a.8.8 0 0 0-1.3.62zM3 6.5v11a.8.8 0 0 0 1.3.62l6.8-5.5a.8.8 0 0 0 0-1.24l-6.8-5.5A.8.8 0 0 0 3 6.5z"/></svg>`,
    minus: `<svg viewBox="0 0 24 24"><rect x="4" y="10.3" width="16" height="3.4" rx="1.2"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><rect x="4" y="10.3" width="16" height="3.4" rx="1.2"/><rect x="10.3" y="4" width="3.4" height="16" rx="1.2"/></svg>`,
    fullscreen: `<svg viewBox="0 0 24 24"><path d="M4 9V4h5v2.2H6.2V9zM15 4h5v5h-2.2V6.2H15zM20 15v5h-5v-2.2h2.8V15zM9 20H4v-5h2.2v2.8H9z"/></svg>`,
    fullscreen_exit: `<svg viewBox="0 0 24 24"><path d="M9 4v5H4V6.8h2.8V4zM20 9h-5V4h2.2v2.8H20zM15 20v-5h5v2.2h-2.8V20zM4 15h5v5H6.8v-2.8H4z"/></svg>`,
  }

  // Upgrade a single <video> element (or selector) into a Perfect Player
  static upgrade = (video, options = {}) => {
    return new PerfectPlayer(video, options)
  }

  // Upgrade every <video> matching the query that is not upgraded yet
  static upgrade_all = (query = `video[data-perfect-player]`, options = {}) => {
    let players = []

    for (let video of document.querySelectorAll(query)) {
      if (video.closest(`.pvp`)) {
        continue
      }

      players.push(PerfectPlayer.upgrade(video, options))
    }

    return players
  }

  // Seconds to "m:ss" or "h:mm:ss"
  static format_time = (secs) => {
    if (!Number.isFinite(secs) || (secs < 0)) {
      secs = 0
    }

    secs = Math.floor(secs)
    let h = Math.floor(secs / 3600)
    let m = Math.floor((secs % 3600) / 60)
    let s = String(secs % 60).padStart(2, `0`)

    if (h > 0) {
      return `${h}:${String(m).padStart(2, `0`)}:${s}`
    }

    return `${m}:${s}`
  }

  static clamp = (num, min, max) => {
    return Math.min(max, Math.max(min, num))
  }

  // Format a skip duration like 5 -> "5s", 60 -> "1m"
  static format_step = (secs) => {
    if ((secs >= 60) && ((secs % 60) === 0)) {
      return `${secs / 60}m`
    }

    return `${secs}s`
  }

  constructor(video, options = {}) {
    this.video = (typeof video === `string`) ? document.querySelector(video) : video

    if (!this.video || (this.video.tagName !== `VIDEO`)) {
      throw new Error(`PerfectPlayer: a <video> element is required`)
    }

    this.options = Object.assign({}, PerfectPlayer.defaults, options)
    this.els = {}
    this.hide_timeout = undefined
    this.frame_request = undefined
    this.seek_request = undefined
    this.repeat_timeout = undefined
    this.dragging_seek = false
    this.dragging_volume = false
    this.drag_ratio = 0
    this.last_spark = 0
    this.spark_count = 0
    this.pointer_inside = false
    this.over_controls = false
    this.last_icon = ``
    this.reduced_motion = window.matchMedia(`(prefers-reduced-motion: reduce)`).matches

    this.build()
    this.setup_video()
    this.setup_stage()
    this.setup_seekbar()
    this.setup_panel()
    this.setup_volume()
    this.setup_keyboard()
    this.setup_autohide()
    this.load_volume()
    this.update_all()
    PerfectPlayer.instances.push(this)
  }

  // Wrap the <video> in the player container and create all the controls
  build = () => {
    let video = this.video
    let root = document.createElement(`div`)
    root.className = `pvp`
    root.tabIndex = 0
    root.setAttribute(`role`, `region`)
    root.setAttribute(`aria-label`, `Video player`)

    // Respect an explicit width given to the original video
    let width = video.getAttribute(`width`)

    if (width) {
      root.style.width = /^\d+$/.test(width) ? `${width}px` : width
    }

    let icons = PerfectPlayer.icons
    let step = PerfectPlayer.format_step(this.options.seek_step)
    let long_step = PerfectPlayer.format_step(this.options.seek_step_long)
    let fs_button = ``

    if (this.options.fullscreen_button) {
      fs_button = `<button class="pvp_button pvp_fullscreen" type="button" aria-label="Fullscreen" title="Fullscreen (F)">${icons.fullscreen}</button>`
    }

    // The stage catches double-clicks on the empty video area. The controls
    // layer sits above it, and only the seekbar, skip buttons, and panel
    // receive pointer events so clicks on them never reach the stage.
    root.innerHTML = `
      <div class="pvp_stage">
        <div class="pvp_flash"></div>
        <div class="pvp_spinner"></div>
      </div>
      <div class="pvp_controls">
        <div class="pvp_seek_zone">
          <div class="pvp_seek_actions">
            <div class="pvp_skip_group">
              <button class="pvp_button pvp_skip pvp_rewind_long" type="button" aria-label="Rewind ${long_step}" title="Rewind ${long_step}">
                ${icons.rewind}<span>-${long_step}</span>
              </button>
              <button class="pvp_button pvp_skip pvp_rewind" type="button" aria-label="Rewind ${step}" title="Rewind ${step} (Left)">
                ${icons.rewind}<span>-${step}</span>
              </button>
            </div>
            <div class="pvp_skip_group">
              <button class="pvp_button pvp_skip pvp_forward" type="button" aria-label="Forward ${step}" title="Forward ${step} (Right)">
                <span>+${step}</span>${icons.forward}
              </button>
              <button class="pvp_button pvp_skip pvp_forward_long" type="button" aria-label="Forward ${long_step}" title="Forward ${long_step}">
                <span>+${long_step}</span>${icons.forward}
              </button>
            </div>
          </div>
          <div class="pvp_seek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="pvp_seek_track">
              <div class="pvp_seek_buffer"></div>
              <div class="pvp_seek_hover"></div>
              <div class="pvp_seek_fill"><div class="pvp_seek_shine"></div></div>
            </div>
            <div class="pvp_seek_thumb"></div>
            <div class="pvp_seek_tip">0:00</div>
            <div class="pvp_sparks"></div>
          </div>
        </div>
        <div class="pvp_panel">
          <div class="pvp_left">
            <button class="pvp_button pvp_play" type="button" aria-label="Play" title="Play (Space)">
              <span class="pvp_play_core"><span class="pvp_play_icon">${icons.play}</span></span>
            </button>
            ${fs_button}
          </div>
          <div class="pvp_time" aria-live="off">
            <span class="pvp_current">0:00</span>
            <span class="pvp_separator">/</span>
            <span class="pvp_duration">0:00</span>
          </div>
          <div class="pvp_volume" title="Volume (wheel, Up/Down)">
            <button class="pvp_button pvp_vol_down" type="button" aria-label="Volume down" title="Volume down (middle-click: 0%)">${icons.minus}</button>
            <div class="pvp_vol_slider" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100">
              <div class="pvp_vol_track"><div class="pvp_vol_fill"></div></div>
              <div class="pvp_vol_thumb"></div>
            </div>
            <button class="pvp_button pvp_vol_up" type="button" aria-label="Volume up" title="Volume up (middle-click: 100%)">${icons.plus}</button>
            <button class="pvp_vol_label" type="button" title="Mute (M)">100%</button>
          </div>
        </div>
      </div>
    `

    // Put the container where the video was, then move the video inside it
    video.parentNode.insertBefore(root, video)
    root.prepend(video)
    video.classList.add(`pvp_video`)
    this.root = root

    let names = [
      `stage`, `flash`, `spinner`, `rewind`, `rewind_long`, `forward`,
      `forward_long`, `seek`, `seek_track`, `seek_buffer`, `seek_hover`,
      `seek_fill`, `seek_thumb`, `seek_tip`, `sparks`, `panel`, `play`,
      `play_icon`, `fullscreen`, `current`, `duration`, `volume`, `vol_down`,
      `vol_slider`, `vol_fill`, `vol_thumb`, `vol_up`, `vol_label`,
    ]

    for (let name of names) {
      this.els[name] = root.querySelector(`.pvp_${name}`)
    }
  }

  // Disable native controls and listen to media events
  setup_video = () => {
    let video = this.video
    video.controls = false
    video.removeAttribute(`controls`)
    video.playsInline = true

    video.addEventListener(`play`, () => {
      this.update_play_state()
      this.start_frame_loop()
    })

    video.addEventListener(`pause`, () => {
      this.update_play_state()
      this.set_loading(false)
    })

    video.addEventListener(`ended`, () => {
      this.update_play_state()
      this.show_controls()
    })

    for (let event of [`timeupdate`, `seeked`]) {
      video.addEventListener(event, () => {
        this.update_progress()
      })
    }

    for (let event of [`durationchange`, `loadedmetadata`, `emptied`]) {
      video.addEventListener(event, () => {
        this.update_ratio()
        this.update_all()
      })
    }

    video.addEventListener(`progress`, () => {
      this.update_buffer()
    })

    video.addEventListener(`volumechange`, () => {
      this.update_volume()
      this.save_volume()
    })

    video.addEventListener(`waiting`, () => {
      this.set_loading(true)
    })

    for (let event of [`playing`, `canplay`, `seeked`]) {
      video.addEventListener(event, () => {
        this.set_loading(false)
      })
    }
  }

  // Double clicking the video toggles fullscreen. A single click on the
  // video does nothing on purpose: playback is only controlled by the play
  // button (or keyboard), so a stray click can never pause the video.
  setup_stage = () => {
    this.els.stage.addEventListener(`dblclick`, () => {
      this.toggle_fullscreen()
    })

    // On touch there is no hover, so a tap toggles the controls instead
    this.els.stage.addEventListener(`click`, (e) => {
      if (e.pointerType !== `touch`) {
        return
      }

      if (this.is_idle()) {
        this.show_controls()
        this.schedule_hide(this.options.hide_delay_idle)
      }
      else {
        this.clear_hide()
        this.hide_controls()
      }
    })
  }

  // The big middle seekbar: click, drag, hover preview and sparks
  setup_seekbar = () => {
    let seek = this.els.seek

    seek.addEventListener(`pointerdown`, (e) => {
      if ((e.button !== 0) || !this.can_seek()) {
        return
      }

      e.preventDefault()
      seek.setPointerCapture(e.pointerId)
      this.dragging_seek = true
      this.root.classList.add(`pvp_seeking`)
      this.clear_hide()
      this.drag_ratio = this.seek_ratio(e)
      this.update_seek_hover(this.drag_ratio)
      this.request_seek()
      this.render_progress(this.drag_ratio)
      this.burst(this.drag_ratio, 10)
    })

    seek.addEventListener(`pointermove`, (e) => {
      let ratio = this.seek_ratio(e)
      this.update_seek_hover(ratio)

      if (!this.dragging_seek) {
        return
      }

      this.drag_ratio = ratio
      this.request_seek()
      this.render_progress(ratio)
      this.trail(ratio)
    })

    let end_drag = () => {
      if (!this.dragging_seek) {
        return
      }

      this.dragging_seek = false
      this.root.classList.remove(`pvp_seeking`)
      this.apply_seek()
      this.schedule_hide(this.options.hide_delay_idle)
    }

    for (let event of [`pointerup`, `pointercancel`, `lostpointercapture`]) {
      seek.addEventListener(event, end_drag)
    }

    seek.addEventListener(`pointerleave`, () => {
      seek.classList.remove(`pvp_hovering`)
    })

    seek.addEventListener(`pointerenter`, () => {
      seek.classList.add(`pvp_hovering`)
    })

    // Rewind and forward skip buttons sitting above the seekbar ends
    this.els.rewind.addEventListener(`click`, () => {
      this.skip(-this.options.seek_step)
    })

    this.els.rewind_long.addEventListener(`click`, () => {
      this.skip(-this.options.seek_step_long)
    })

    this.els.forward.addEventListener(`click`, () => {
      this.skip(this.options.seek_step)
    })

    this.els.forward_long.addEventListener(`click`, () => {
      this.skip(this.options.seek_step_long)
    })
  }

  // Bottom panel: play, fullscreen, ripples
  setup_panel = () => {
    this.els.play.addEventListener(`click`, () => {
      this.toggle_play()
    })

    if (this.els.fullscreen) {
      this.els.fullscreen.addEventListener(`click`, () => {
        this.toggle_fullscreen()
      })
    }

    this.root.addEventListener(`fullscreenchange`, () => {
      this.update_fullscreen()
    })

    // A small light ripple on every button press
    for (let button of this.root.querySelectorAll(`.pvp_button, .pvp_vol_label`)) {
      button.addEventListener(`pointerdown`, (e) => {
        this.ripple(button, e)
      })
    }

    // Single clicks on the panel background do nothing; double-clicking the
    // empty panel background toggles fullscreen (ignoring rapid clicks on buttons).
    this.els.panel.addEventListener(`dblclick`, (e) => {
      if (e.target.closest(`button, .pvp_vol_slider`)) {
        return
      }

      this.toggle_fullscreen()
    })
  }

  // Volume: -/+ buttons (hold to repeat, middle-click for min/max), slider, label, wheel
  setup_volume = () => {
    let step = this.options.volume_step

    let hold = (button, amount, extreme) => {
      // Prevent browser autoscroll on middle-click
      button.addEventListener(`mousedown`, (e) => {
        if (e.button === 1) {
          e.preventDefault()
        }
      })

      button.addEventListener(`pointerdown`, (e) => {
        if (e.button === 1) {
          e.preventDefault()
          this.stop_repeat()
          this.set_volume(extreme)
          this.bump_volume()
          return
        }

        if (e.button !== 0) {
          return
        }

        this.change_volume(amount)
        this.stop_repeat()

        // Keep changing while the button is held down
        let repeat = (delay) => {
          this.repeat_timeout = setTimeout(() => {
            this.change_volume(amount)
            repeat(90)
          }, delay)
        }

        repeat(420)
      })

      for (let event of [`pointerup`, `pointerleave`, `pointercancel`]) {
        button.addEventListener(event, () => {
          this.stop_repeat()
        })
      }

      // Keyboard activation (Enter/Space) produces a click with detail 0
      button.addEventListener(`click`, (e) => {
        if (e.detail === 0) {
          this.change_volume(amount)
        }
      })
    }

    hold(this.els.vol_down, -step, 0)
    hold(this.els.vol_up, step, 100)
    let slider = this.els.vol_slider

    slider.addEventListener(`pointerdown`, (e) => {
      if (e.button !== 0) {
        return
      }

      e.preventDefault()
      slider.setPointerCapture(e.pointerId)
      this.dragging_volume = true
      this.root.classList.add(`pvp_vol_dragging`)
      this.clear_hide()
      this.set_volume(this.volume_ratio(e) * 100)
    })

    slider.addEventListener(`pointermove`, (e) => {
      if (this.dragging_volume) {
        this.set_volume(this.volume_ratio(e) * 100)
      }
    })

    let end_drag = () => {
      if (!this.dragging_volume) {
        return
      }

      this.dragging_volume = false
      this.root.classList.remove(`pvp_vol_dragging`)
      this.schedule_hide(this.options.hide_delay_idle)
    }

    for (let event of [`pointerup`, `pointercancel`, `lostpointercapture`]) {
      slider.addEventListener(event, end_drag)
    }

    this.els.vol_label.addEventListener(`click`, () => {
      this.toggle_mute()
    })

    // Wheel anywhere on the volume area changes volume by one step
    this.els.volume.addEventListener(`wheel`, (e) => {
      e.preventDefault()

      if (e.deltaY === 0) {
        return
      }

      this.change_volume(e.deltaY < 0 ? step : -step)
    }, {passive: false})
  }

  // Shortcuts while the player has focus
  setup_keyboard = () => {
    // Clicking anywhere in the player focuses it so shortcuts work
    this.root.addEventListener(`pointerdown`, () => {
      this.root.focus({preventScroll: true})
    })

    if (!this.options.keyboard) {
      return
    }

    this.root.addEventListener(`keydown`, (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return
      }

      let key = e.key.toLowerCase()
      let on_button = e.target.tagName === `BUTTON`
      let handled = true

      if ((key === ` `) && !on_button) {
        this.toggle_play()
      }
      else if (key === `k`) {
        this.toggle_play()
      }
      else if (key === `arrowleft`) {
        this.skip(-this.options.seek_step)
      }
      else if (key === `arrowright`) {
        this.skip(this.options.seek_step)
      }
      else if (key === `j`) {
        this.skip(-10)
      }
      else if (key === `l`) {
        this.skip(10)
      }
      else if (key === `arrowup`) {
        this.change_volume(this.options.volume_step)
      }
      else if (key === `arrowdown`) {
        this.change_volume(-this.options.volume_step)
      }
      else if (key === `m`) {
        this.toggle_mute()
      }
      else if (key === `f`) {
        this.toggle_fullscreen()
      }
      else if (key === `home`) {
        this.seek_to(0)
      }
      else if (key === `end`) {
        this.seek_to(this.video.duration)
      }
      else if (/^[0-9]$/.test(key) && this.can_seek()) {
        this.seek_to(this.video.duration * (parseInt(key) / 10))
      }
      else {
        handled = false
      }

      if (handled) {
        e.preventDefault()
        this.show_controls()
        this.schedule_hide(this.options.hide_delay_idle)
      }
    })
  }

  // Controls appear on movement, hide after leaving the player or sitting
  // idle over the empty video area (never while hovering the controls).
  setup_autohide = () => {
    let control_areas = [
      this.els.panel,
      this.els.seek,
      this.els.rewind,
      this.els.rewind_long,
      this.els.forward,
      this.els.forward_long,
    ]

    for (let el of control_areas) {
      el.addEventListener(`pointerenter`, (e) => {
        if (e.pointerType === `touch`) {
          return
        }

        this.over_controls = true
        this.clear_hide()
      })

      el.addEventListener(`pointerleave`, (e) => {
        if (e.pointerType === `touch`) {
          return
        }

        this.over_controls = false

        if (this.pointer_inside) {
          this.schedule_hide(this.options.hide_delay_idle)
        }
      })
    }

    this.root.addEventListener(`pointermove`, (e) => {
      // Touch "moves" while tapping, those are handled by the stage click
      if (e.pointerType === `touch`) {
        return
      }

      this.pointer_inside = true
      this.over_controls = Boolean(e.target.closest(`.pvp_panel, .pvp_seek, .pvp_skip`))
      this.show_controls()

      if (this.over_controls) {
        this.clear_hide()
      }
      else {
        this.schedule_hide(this.options.hide_delay_idle)
      }
    })

    this.root.addEventListener(`pointerleave`, (e) => {
      if (e.pointerType === `touch`) {
        return
      }

      this.pointer_inside = false
      this.over_controls = false
      this.schedule_hide(this.options.hide_delay_leave)
    })
  }

  // ---------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------

  play = () => {
    let promise = this.video.play()

    if (promise) {
      promise.catch((err) => {
        console.error(`PerfectPlayer: playback failed`, err)
      })
    }
  }

  pause = () => {
    this.video.pause()
  }

  toggle_play = () => {
    if (this.video.paused || this.video.ended) {
      this.play()
      this.flash(`play`)
    }
    else {
      this.pause()
      this.flash(`pause`)
    }
  }

  can_seek = () => {
    let duration = this.video.duration
    return Number.isFinite(duration) && (duration > 0)
  }

  seek_to = (time) => {
    if (!this.can_seek()) {
      return
    }

    this.video.currentTime = PerfectPlayer.clamp(time, 0, this.video.duration)
    this.update_progress()
  }

  skip = (secs) => {
    if (!this.can_seek()) {
      return
    }

    this.seek_to(this.video.currentTime + secs)
    this.burst(this.video.currentTime / this.video.duration, 6)
  }

  // Seeking while dragging is throttled to one seek per animation frame
  request_seek = () => {
    if (this.seek_request) {
      return
    }

    this.seek_request = requestAnimationFrame(() => {
      this.seek_request = undefined
      this.apply_seek()
    })
  }

  apply_seek = () => {
    this.seek_to(this.drag_ratio * this.video.duration)
  }

  // ---------------------------------------------------------------------
  // Volume
  // ---------------------------------------------------------------------

  // Current volume in whole percent
  get_volume = () => {
    return Math.round(this.video.volume * 100)
  }

  set_volume = (percent) => {
    percent = Math.round(PerfectPlayer.clamp(percent, 0, 100))
    this.video.volume = percent / 100

    // Raising the volume implies the user wants to hear it
    if (this.video.muted && (percent > 0)) {
      this.video.muted = false
    }

    this.update_volume()
  }

  bump_volume = () => {
    this.els.vol_label.classList.remove(`pvp_bump`)

    // Force a reflow so the bump animation restarts on every change
    void this.els.vol_label.offsetWidth
    this.els.vol_label.classList.add(`pvp_bump`)
  }

  change_volume = (amount) => {
    this.set_volume(this.get_volume() + amount)
    this.bump_volume()
  }

  toggle_mute = () => {
    this.video.muted = !this.video.muted
  }

  stop_repeat = () => {
    clearTimeout(this.repeat_timeout)
    this.repeat_timeout = undefined
  }

  load_volume = () => {
    if (!this.options.remember_volume) {
      return
    }

    try {
      let saved = parseInt(localStorage.getItem(this.options.storage_key))

      if (!Number.isNaN(saved)) {
        this.video.volume = PerfectPlayer.clamp(saved, 0, 100) / 100
      }
    }
    catch (err) {
      // Storage can be unavailable (privacy modes), that's fine
    }
  }

  save_volume = () => {
    if (!this.options.remember_volume) {
      return
    }

    try {
      localStorage.setItem(this.options.storage_key, String(this.get_volume()))
    }
    catch (err) {
      // Ignore storage errors
    }
  }

  // ---------------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------------

  is_fullscreen = () => {
    return document.fullscreenElement === this.root
  }

  toggle_fullscreen = () => {
    if (this.is_fullscreen()) {
      document.exitFullscreen()
    }
    else if (this.root.requestFullscreen) {
      this.root.requestFullscreen().catch((err) => {
        console.error(`PerfectPlayer: fullscreen failed`, err)
      })
    }
  }

  // ---------------------------------------------------------------------
  // Controls visibility
  // ---------------------------------------------------------------------

  is_idle = () => {
    return this.root.classList.contains(`pvp_idle`)
  }

  show_controls = () => {
    if (!this.is_idle()) {
      return
    }

    this.root.classList.remove(`pvp_idle`)
    this.update_progress()
    this.start_frame_loop()
  }

  hide_controls = () => {
    // Never hide during a drag or while the cursor rests on controls
    if (this.dragging_seek || this.dragging_volume || this.over_controls) {
      return
    }

    this.root.classList.add(`pvp_idle`)
    this.stop_repeat()
  }

  schedule_hide = (delay) => {
    this.clear_hide()

    this.hide_timeout = setTimeout(() => {
      this.hide_controls()
    }, delay)
  }

  clear_hide = () => {
    clearTimeout(this.hide_timeout)
    this.hide_timeout = undefined
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  update_all = () => {
    this.update_play_state()
    this.update_progress()
    this.update_buffer()
    this.update_volume()
    this.update_fullscreen()
  }

  // Use the real aspect ratio of the video once it's known
  update_ratio = () => {
    let video = this.video

    if (video.videoWidth && video.videoHeight) {
      this.root.style.setProperty(`--pvp_ratio`, `${video.videoWidth} / ${video.videoHeight}`)
    }
  }

  update_play_state = () => {
    let video = this.video
    let playing = !video.paused && !video.ended
    let icons = PerfectPlayer.icons
    this.root.classList.toggle(`pvp_playing`, playing)
    let icon = playing ? `pause` : (video.ended ? `replay` : `play`)
    let label = playing ? `Pause` : (video.ended ? `Replay` : `Play`)
    this.els.play.setAttribute(`aria-label`, label)
    this.els.play.title = `${label} (Space)`

    // Only swap (and animate) the icon when it actually changes
    if (icon !== this.last_icon) {
      let el = this.els.play_icon
      el.innerHTML = icons[icon]
      el.classList.remove(`pvp_pop`)
      void el.offsetWidth
      el.classList.add(`pvp_pop`)
      this.last_icon = icon
    }
  }

  // Smooth progress while playing. The loop only runs while the video is
  // playing AND the controls are visible, so it costs nothing otherwise.
  start_frame_loop = () => {
    if (this.frame_request) {
      return
    }

    let tick = () => {
      this.frame_request = undefined

      if (this.video.paused || this.is_idle()) {
        return
      }

      this.update_progress()
      this.frame_request = requestAnimationFrame(tick)
    }

    this.frame_request = requestAnimationFrame(tick)
  }

  update_progress = () => {
    // While dragging, the drag position is the source of truth
    if (this.dragging_seek) {
      return
    }

    let video = this.video
    let ratio = this.can_seek() ? (video.currentTime / video.duration) : 0
    this.render_progress(ratio)
  }

  render_progress = (ratio) => {
    let video = this.video
    let percent = `${(ratio * 100).toFixed(3)}%`
    this.els.seek_fill.style.width = percent
    this.els.seek_thumb.style.left = percent
    this.els.seek.setAttribute(`aria-valuenow`, Math.round(ratio * 100))
    let live = video.duration === Infinity
    let seekable = this.can_seek()
    this.root.classList.toggle(`pvp_no_seek`, !seekable)
    this.els.rewind.disabled = !seekable
    this.els.rewind_long.disabled = !seekable
    this.els.forward.disabled = !seekable
    this.els.forward_long.disabled = !seekable

    if (this.dragging_seek) {
      this.els.current.textContent = PerfectPlayer.format_time(ratio * video.duration)
    }
    else {
      this.els.current.textContent = PerfectPlayer.format_time(video.currentTime)
    }

    this.els.duration.textContent = live ? `LIVE` : PerfectPlayer.format_time(video.duration)
  }

  update_buffer = () => {
    let video = this.video
    let end = 0

    // Show the buffered range that contains the playhead
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= (video.currentTime + 0.5)) {
        end = video.buffered.end(i)
      }
    }

    let ratio = this.can_seek() ? (end / video.duration) : 0
    this.els.seek_buffer.style.width = `${PerfectPlayer.clamp(ratio, 0, 1) * 100}%`
  }

  update_volume = () => {
    let percent = this.get_volume()
    let muted = this.video.muted || (percent === 0)
    // The fill and thumb read this variable (see perfect_player.css)
    this.els.volume.style.setProperty(`--pvp_vol`, `${percent}%`)

    this.els.vol_slider.setAttribute(`aria-valuenow`, percent)
    this.els.vol_label.textContent = this.video.muted ? `MUTE` : `${percent}%`
    this.els.vol_label.setAttribute(`aria-label`, this.video.muted ? `Unmute` : `Mute`)
    this.els.volume.classList.toggle(`pvp_muted`, muted)
    this.els.vol_down.disabled = percent === 0
    this.els.vol_up.disabled = percent === 100
  }

  update_fullscreen = () => {
    let full = this.is_fullscreen()
    this.root.classList.toggle(`pvp_full`, full)

    if (this.els.fullscreen) {
      let icons = PerfectPlayer.icons
      this.els.fullscreen.innerHTML = full ? icons.fullscreen_exit : icons.fullscreen
      this.els.fullscreen.setAttribute(`aria-label`, full ? `Exit fullscreen` : `Fullscreen`)
    }
  }

  update_seek_hover = (ratio) => {
    let percent = `${ratio * 100}%`
    this.els.seek_hover.style.width = percent
    this.els.seek_tip.style.setProperty(`--pvp_tip_x`, percent)
    this.els.seek_tip.textContent = PerfectPlayer.format_time(ratio * this.video.duration)
  }

  set_loading = (loading) => {
    this.root.classList.toggle(`pvp_loading`, loading)
  }

  // Horizontal position of a pointer event on the seek track, from 0 to 1
  seek_ratio = (e) => {
    let rect = this.els.seek_track.getBoundingClientRect()
    return PerfectPlayer.clamp((e.clientX - rect.left) / rect.width, 0, 1)
  }

  volume_ratio = (e) => {
    let rect = this.els.vol_slider.getBoundingClientRect()
    return PerfectPlayer.clamp((e.clientX - rect.left) / rect.width, 0, 1)
  }

  // ---------------------------------------------------------------------
  // Effects (all short lived, GPU friendly: only transform and opacity)
  // ---------------------------------------------------------------------

  effects_enabled = () => {
    return this.options.particles && !this.reduced_motion
  }

  // Big icon in the center that pops and fades when toggling playback
  flash = (name) => {
    let flash = this.els.flash
    flash.innerHTML = PerfectPlayer.icons[name]
    flash.classList.remove(`pvp_flash_on`)
    void flash.offsetWidth
    flash.classList.add(`pvp_flash_on`)
  }

  // Spawn one spark at a position (0 to 1) of the seekbar
  spark = (ratio, power = 1) => {
    if (!this.effects_enabled() || (this.spark_count >= PerfectPlayer.max_sparks)) {
      return
    }

    let el = document.createElement(`div`)
    el.className = `pvp_spark`
    let angle = Math.random() * Math.PI * 2
    let distance = (14 + (Math.random() * 30)) * power
    el.style.left = `${ratio * 100}%`
    el.style.setProperty(`--dx`, `${Math.cos(angle) * distance}px`)
    el.style.setProperty(`--dy`, `${Math.sin(angle) * distance * 0.8}px`)
    el.style.setProperty(`--size`, `${2 + (Math.random() * 3)}px`)
    el.style.animationDuration = `${420 + (Math.random() * 380)}ms`
    this.spark_count += 1

    el.addEventListener(`animationend`, () => {
      el.remove()
      this.spark_count -= 1
    })

    this.els.sparks.append(el)
  }

  // A burst of sparks, used on click and keyboard skips
  burst = (ratio, amount) => {
    for (let i = 0; i < amount; i++) {
      this.spark(ratio, 1.2)
    }
  }

  // A light trail of sparks while dragging, throttled by time
  trail = (ratio) => {
    let now = performance.now()

    if ((now - this.last_spark) < 28) {
      return
    }

    this.last_spark = now
    this.spark(ratio, 0.7)
  }

  // Expanding light circle from the press point of a button
  ripple = (button, e) => {
    if (this.reduced_motion) {
      return
    }

    let rect = button.getBoundingClientRect()
    let el = document.createElement(`span`)
    el.className = `pvp_ripple`
    el.style.left = `${e.clientX - rect.left}px`
    el.style.top = `${e.clientY - rect.top}px`

    el.addEventListener(`animationend`, () => {
      el.remove()
    })

    button.append(el)
  }

  // ---------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------

  // Remove the player and put the original <video> back in its place
  destroy = () => {
    this.clear_hide()
    this.stop_repeat()
    cancelAnimationFrame(this.frame_request)
    cancelAnimationFrame(this.seek_request)
    this.video.classList.remove(`pvp_video`)
    this.video.controls = true
    this.root.parentNode.insertBefore(this.video, this.root)
    this.root.remove()
    let index = PerfectPlayer.instances.indexOf(this)

    if (index !== -1) {
      PerfectPlayer.instances.splice(index, 1)
    }
  }
}

// Auto upgrade <video data-perfect-player> elements once the DOM is ready
if (document.readyState === `loading`) {
  document.addEventListener(`DOMContentLoaded`, () => {
    PerfectPlayer.upgrade_all()
  })
}
else {
  PerfectPlayer.upgrade_all()
}
