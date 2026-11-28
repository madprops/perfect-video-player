/*
  Perfect Video Player
  ====================

  A drop-in replacement for the native <video> controls.

  Design goals:
  - A full-width seekbar directly above the bottom panel, big and easy to drag.
  - A big play/pause button on the bottom left, flanked by skip buttons
    (-1m / -10s / play / +10s / +1m) when there is room.
  - Volume and a compact fullscreen button on the bottom right, with -5% / +5%
    buttons, a clickable slider, a percentage label, and mouse wheel support.
  - A big, readable "current / duration" label in the middle of the panel.
  - A single click on empty video space toggles play/pause,
    a double click toggles fullscreen.
  - Controls hide 0.5 seconds after the cursor leaves the player,
    after 2 seconds without cursor movement over the empty video area
    (never while hovering the panel or seekbar), or immediately when
    entering fullscreen (ignoring movement for 0.5 seconds).

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
    // Volume change in percent for buttons and arrow keys
    volume_step: 5,
    // Volume change in percent for mouse wheel
    volume_step_wheel: 2,
    // Seconds to skip with the -10s/+10s buttons and left/right arrow keys
    seek_step: 10,
    // Seconds to skip with the -1m/+1m buttons
    seek_step_long: 60,
    // Hide controls this many ms after the cursor leaves the player
    hide_delay_leave: 1000,
    // Hide controls this many ms after the cursor stops moving over empty video
    hide_delay_idle: 2000,
    // Ignore pointer movement for this many ms after entering fullscreen
    fullscreen_hide_block: 800,
    // Max ms the LCD info ticker can hold controls open before allowing autohide
    info_hide_block: 12000,
    // Single click on empty video space toggles play/pause
    click_to_play: true,
    // Remember the volume across page loads with localStorage
    remember_volume: true,
    storage_key: `perfect_player_volume`,
    // Show a compact fullscreen button on the bottom right
    fullscreen_button: true,
    // Sparks on the seekbar (automatically off with prefers-reduced-motion)
    particles: true,
    // Keyboard shortcuts while the player is focused
    keyboard: true,
  }

  // Every player created so far
  static instances = []

  // Lookup table from <video> element to its PerfectPlayer instance
  static map = new WeakMap()

  // Maximum sparks alive at the same time per player (keeps it cheap)
  static max_sparks = 36

  // Inline SVG icons, they inherit color through currentColor
  static icons = {
    play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24"><rect x="5.5" y="4" width="4.6" height="16" rx="1.2"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.2"/></svg>`,
    replay: `<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6.5 12 11V8a5 5 0 1 1-5 5H4.5A7.5 7.5 0 1 0 12 5.5z"/></svg>`,
    rewind: `<svg viewBox="0 0 24 24"><path d="M11.6 17.5V6.5a.8.8 0 0 0-1.3-.62l-6.8 5.5a.8.8 0 0 0 0 1.24l6.8 5.5a.8.8 0 0 0 1.3-.62zm9.4 0V6.5a.8.8 0 0 0-1.3-.62l-6.8 5.5a.8.8 0 0 0 0 1.24l6.8 5.5a.8.8 0 0 0 1.3-.62z"/></svg>`,
    rewind_short: `<svg viewBox="0 0 24 24"><path d="M16.5 17.5V6.5a.8.8 0 0 0-1.3-.62l-7.2 5.5a.8.8 0 0 0 0 1.24l7.2 5.5a.8.8 0 0 0 1.3-.62z"/></svg>`,
    forward: `<svg viewBox="0 0 24 24"><path d="M12.4 6.5v11a.8.8 0 0 0 1.3.62l6.8-5.5a.8.8 0 0 0 0-1.24l-6.8-5.5a.8.8 0 0 0-1.3.62zM3 6.5v11a.8.8 0 0 0 1.3.62l6.8-5.5a.8.8 0 0 0 0-1.24l-6.8-5.5A.8.8 0 0 0 3 6.5z"/></svg>`,
    forward_short: `<svg viewBox="0 0 24 24"><path d="M7.5 6.5v11a.8.8 0 0 0 1.3.62l7.2-5.5a.8.8 0 0 0 0-1.24l-7.2-5.5a.8.8 0 0 0-1.3.62z"/></svg>`,
    minus: `<svg viewBox="0 0 24 24"><rect x="4" y="10.3" width="16" height="3.4" rx="1.2"/></svg>`,
    plus: `<svg viewBox="0 0 24 24"><rect x="4" y="10.3" width="16" height="3.4" rx="1.2"/><rect x="10.3" y="4" width="3.4" height="16" rx="1.2"/></svg>`,
    fullscreen: `<svg viewBox="0 0 24 24"><path d="M4 9V4h5v2.2H6.2V9zM15 4h5v5h-2.2V6.2H15zM20 15v5h-5v-2.2h2.8V15zM9 20H4v-5h2.2v2.8H9z"/></svg>`,
    fullscreen_exit: `<svg viewBox="0 0 24 24"><path d="M9 4v5H4V6.8h2.8V4zM20 9h-5V4h2.2v2.8H20zM15 20v-5h5v2.2h-2.8V20zM4 15h5v5H6.8v-2.8H4z"/></svg>`,
  }

  // Return the existing PerfectPlayer instance for a <video> (or selector)
  static get = (video) => {
    let el = (typeof video === `string`) ? document.querySelector(video) : video

    if (!el) {
      return null
    }

    return PerfectPlayer.map.get(el) || null
  }

  // Parse data-pvp-* attributes on a <video> into an options object
  static read_data_options = (video) => {
    let parsed = {}

    for (let [key, def] of Object.entries(PerfectPlayer.defaults)) {
      let camel = key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase())
      let attr = `pvp${camel[0].toUpperCase()}${camel.slice(1)}`

      if (!(attr in video.dataset)) {
        continue
      }

      let raw = video.dataset[attr].trim()

      if (typeof def === `boolean`) {
        if ((raw === ``) || (raw === `true`) || (raw === `1`)) {
          parsed[key] = true
        }
        else if ((raw === `false`) || (raw === `0`)) {
          parsed[key] = false
        }
      }
      else if (typeof def === `number`) {
        let num = Number(raw)

        if (Number.isFinite(num)) {
          parsed[key] = num
        }
      }
      else {
        parsed[key] = raw
      }
    }

    return parsed
  }

  // Upgrade a single <video> element (or selector) into a Perfect Player
  static upgrade = (video, options = {}) => {
    let existing = PerfectPlayer.get(video)

    if (existing) {
      return existing
    }

    return new PerfectPlayer(video, options)
  }

  // Upgrade every <video> matching the query that is not upgraded yet
  static upgrade_all = (query = `video[data-perfect-player]`, options = {}) => {
    let players = []

    for (let video of document.querySelectorAll(query)) {
      if (PerfectPlayer.get(video) || video.closest(`.pvp`)) {
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

  // Extract a readable basename from a URL or path (ignoring blob:/data: URLs)
  static extract_filename = (src) => {
    if (!src) {
      return ``
    }

    let trimmed = src.trim()

    if (!trimmed || /^(blob|data):/i.test(trimmed)) {
      return ``
    }

    let path = trimmed

    try {
      path = new URL(trimmed, window.location.href).pathname
    }
    catch (err) {
      path = trimmed.split(/[?#]/)[0]
    }

    let parts = path.split(`/`).filter(Boolean)
    let name = parts.length ? parts[parts.length - 1] : ``

    if (!name) {
      return ``
    }

    try {
      return decodeURIComponent(name)
    }
    catch (err) {
      return name
    }
  }

  constructor(video, options = {}) {
    this.video = (typeof video === `string`) ? document.querySelector(video) : video

    if (!this.video || (this.video.tagName !== `VIDEO`)) {
      throw new Error(`PerfectPlayer: a <video> element is required`)
    }

    this.options = Object.assign(
      {},
      PerfectPlayer.defaults,
      PerfectPlayer.read_data_options(this.video),
      options,
    )

    this.els = {}
    this.abort = new AbortController()
    this.hide_timeout = undefined
    this.hide_delay = 0
    this.click_timeout = undefined
    this.save_volume_timeout = undefined
    this.info_start_timeout = undefined
    this.info_end_timeout = undefined
    this.info_hold_timeout = undefined
    this.holding_info = false
    this.frame_request = undefined
    this.seek_request = undefined
    this.restore_check_request = undefined
    this.repeat_timeout = undefined
    this.resize_observer = undefined
    this.mutation_observer = undefined
    this.dragging_seek = false
    this.dragging_volume = false
    this.drag_ratio = 0
    this.seek_dirty = false
    this.last_spark = 0
    this.spark_count = 0
    this.last_click_toggle = 0
    this.block_controls_until = 0
    this.was_fullscreen = false
    this.pointer_inside = false
    this.has_pointer = false
    this.pointer_screen_x = 0
    this.pointer_screen_y = 0
    this.has_viewport_offset = false
    this.viewport_offset_x = 0
    this.viewport_offset_y = 0
    this.over_controls = false
    this.last_pointer_type = ``
    this.last_icon = ``
    this.reduced_motion = window.matchMedia(`(prefers-reduced-motion: reduce)`).matches

    this.build()
    this.setup_layout()
    this.setup_video()
    this.setup_stage()
    this.setup_seekbar()
    this.setup_panel()
    this.setup_volume()
    this.setup_keyboard()
    this.setup_autohide()
    this.load_volume()
    this.update_ratio()
    this.update_all()

    if (!this.video.paused && !this.video.ended && !this.is_idle()) {
      this.start_frame_loop()
    }

    PerfectPlayer.map.set(this.video, this)
    PerfectPlayer.instances.push(this)
  }

  // Wrap the <video> in the player container and create all the controls
  build = () => {
    let video = this.video
    let parent = video.parentNode
    let parent_style = getComputedStyle(parent)
    let video_style = getComputedStyle(video)
    let root = document.createElement(`div`)
    root.className = `pvp`
    root.tabIndex = 0
    root.setAttribute(`role`, `region`)
    root.setAttribute(`aria-label`, `Video player`)

    // Preserve column-flex alignment (e.g. centered previews) on the wrapper
    if (((parent_style.display === `flex`) || (parent_style.display === `inline-flex`)) &&
      parent_style.flexDirection.startsWith(`column`) &&
      (parent_style.alignItems !== `normal`) &&
      (parent_style.alignItems !== `stretch`)) {
      root.style.display = `flex`
      root.style.flexDirection = `column`
      root.style.alignItems = parent_style.alignItems
    }

    // Preserve explicit 100% height when the host sizes <video> to fill its parent
    if (video_style.height === `100%`) {
      root.style.height = `100%`
    }

    // Respect an explicit width attribute given to the original video
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

    // The overlay tracks the <video>'s exact rendered box. The stage lets
    // pointer events pass through to <video> so host listeners and the native
    // context menu keep working; only the seekbar and panel capture pointer events.
    root.innerHTML = `
      <div class="pvp_overlay">
        <div class="pvp_stage">
          <div class="pvp_flash"></div>
          <div class="pvp_spinner"></div>
        </div>
        <div class="pvp_controls">
          <div class="pvp_dock">
            <div class="pvp_seek_zone">
              <div class="pvp_seek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="pvp_seek_bar">
                  <div class="pvp_seek_track">
                    <div class="pvp_seek_buffer"></div>
                    <div class="pvp_seek_hover"></div>
                    <div class="pvp_seek_fill"></div>
                  </div>
                  <div class="pvp_seek_thumb"></div>
                  <div class="pvp_sparks"></div>
                </div>
                <div class="pvp_seek_tip">0:00</div>
              </div>
            </div>
            <div class="pvp_panel">
              <div class="pvp_left">
                <button class="pvp_button pvp_skip pvp_rewind_long" type="button" aria-label="Rewind ${long_step}" title="Rewind ${long_step}">
                  ${icons.rewind}<span>${long_step}</span>
                </button>
                <button class="pvp_button pvp_skip pvp_rewind" type="button" aria-label="Rewind ${step}" title="Rewind ${step} (Left)">
                  ${icons.rewind_short}<span>${step}</span>
                </button>
                <button class="pvp_button pvp_play" type="button" aria-label="Play" title="Play (Space)">
                  <span class="pvp_play_core"><span class="pvp_play_icon">${icons.play}</span></span>
                </button>
                <button class="pvp_button pvp_skip pvp_forward" type="button" aria-label="Forward ${step}" title="Forward ${step} (Right)">
                  <span>${step}</span>${icons.forward_short}
                </button>
                <button class="pvp_button pvp_skip pvp_forward_long" type="button" aria-label="Forward ${long_step}" title="Forward ${long_step}">
                  <span>${long_step}</span>${icons.forward}
                </button>
              </div>
              <button class="pvp_time" type="button" aria-live="off" title="Show filename">
                <span class="pvp_time_numbers">
                  <span class="pvp_current">0:00</span>
                  <span class="pvp_separator">/</span>
                  <span class="pvp_duration">0:00</span>
                </span>
                <span class="pvp_time_info" aria-hidden="true">
                  <span class="pvp_time_info_text"></span>
                </span>
              </button>
              <div class="pvp_right">
                <div class="pvp_volume" title="Volume (wheel, Up/Down)">
                  <button class="pvp_button pvp_vol_down" type="button" aria-label="Volume down" title="Volume down (middle-click: 0%)">${icons.minus}</button>
                  <div class="pvp_vol_slider" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100">
                    <div class="pvp_vol_track"><div class="pvp_vol_fill"></div></div>
                    <div class="pvp_vol_thumb"></div>
                  </div>
                  <button class="pvp_button pvp_vol_up" type="button" aria-label="Volume up" title="Volume up (middle-click: 100%)">${icons.plus}</button>
                  <button class="pvp_vol_label" type="button" title="Mute (M)">100</button>
                </div>
                ${fs_button}
              </div>
            </div>
          </div>
        </div>
      </div>
    `

    // Put the container where the video was, then move the video inside it
    parent.insertBefore(root, video)
    root.prepend(video)
    video.classList.add(`pvp_video`)
    this.root = root

    let names = [
      `overlay`, `stage`, `flash`, `spinner`, `rewind`, `rewind_long`, `forward`,
      `forward_long`, `seek`, `seek_track`, `seek_buffer`, `seek_hover`,
      `seek_fill`, `seek_thumb`, `seek_tip`, `sparks`, `panel`, `play`,
      `play_icon`, `fullscreen`, `time`, `time_info`, `time_info_text`,
      `current`, `duration`, `volume`, `vol_down`, `vol_slider`, `vol_fill`,
      `vol_thumb`, `vol_up`, `vol_label`,
    ]

    for (let name of names) {
      this.els[name] = root.querySelector(`.pvp_${name}`)
    }
  }

  // Keep the overlay aligned with <video> and mirror hide/show state
  setup_layout = () => {
    if (typeof ResizeObserver !== `undefined`) {
      this.resize_observer = new ResizeObserver(() => {
        this.sync_overlay()
      })

      this.resize_observer.observe(this.video)
      this.resize_observer.observe(this.root)
    }

    if (typeof MutationObserver !== `undefined`) {
      this.mutation_observer = new MutationObserver(() => {
        this.sync_visibility()
        this.sync_overlay()
      })

      this.mutation_observer.observe(this.video, {
        attributes: true,
        attributeFilter: [`class`, `style`, `hidden`],
      })
    }

    this.sync_visibility()
    this.sync_overlay()
  }

  // Mirror display: none toggled directly on <video> onto the wrapper
  sync_visibility = () => {
    let hidden = getComputedStyle(this.video).display === `none`
    this.root.classList.toggle(`pvp_hidden`, hidden)
  }

  // Match .pvp_overlay to the <video>'s exact rendered box inside .pvp
  sync_overlay = () => {
    let overlay = this.els.overlay

    if (this.is_fullscreen()) {
      overlay.classList.remove(`pvp_overlay_hidden`)
      return
    }

    let video = this.video
    let width = video.clientWidth
    let height = video.clientHeight

    if ((width === 0) || (height === 0)) {
      overlay.classList.add(`pvp_overlay_hidden`)
      return
    }

    overlay.classList.remove(`pvp_overlay_hidden`)
    overlay.style.left = `${video.offsetLeft + video.clientLeft}px`
    overlay.style.top = `${video.offsetTop + video.clientTop}px`
    overlay.style.width = `${width}px`
    overlay.style.height = `${height}px`
    overlay.style.borderRadius = getComputedStyle(video).borderRadius
  }

  // Disable native controls and listen to media events
  setup_video = () => {
    let video = this.video
    let signal = this.abort.signal
    video.controls = false
    video.removeAttribute(`controls`)
    video.playsInline = true

    video.addEventListener(`play`, () => {
      this.update_play_state()
      this.start_frame_loop()
    }, {signal})

    video.addEventListener(`pause`, () => {
      this.update_play_state()
      this.set_loading(false)
    }, {signal})

    video.addEventListener(`ended`, () => {
      this.update_play_state()
      this.show_controls()
    }, {signal})

    for (let event of [`timeupdate`, `seeked`]) {
      video.addEventListener(event, () => {
        this.update_progress()
        this.update_buffer()
      }, {signal})
    }

    video.addEventListener(`seeked`, () => {
      if (this.dragging_seek && this.seek_dirty) {
        this.request_seek()
      }
    }, {signal})

    for (let event of [`loadstart`, `emptied`]) {
      video.addEventListener(event, () => {
        this.hide_info()
      }, {signal})
    }

    for (let event of [`durationchange`, `loadedmetadata`, `emptied`]) {
      video.addEventListener(event, () => {
        this.update_ratio()
        this.update_all()
        this.sync_overlay()
      }, {signal})
    }

    for (let event of [`progress`, `loadeddata`, `canplay`, `canplaythrough`]) {
      video.addEventListener(event, () => {
        this.update_buffer()
      }, {signal})
    }

    video.addEventListener(`volumechange`, () => {
      this.update_volume()
      this.schedule_save_volume()
    }, {signal})

    video.addEventListener(`waiting`, () => {
      this.set_loading(true)
    }, {signal})

    video.addEventListener(`playing`, () => {
      this.start_frame_loop()
    }, {signal})

    for (let event of [`playing`, `canplay`, `seeked`]) {
      video.addEventListener(event, () => {
        this.set_loading(false)
      }, {signal})
    }
  }

  // Clicking empty video space toggles play/pause (mouse/pen) or controls
  // (touch); double clicking toggles fullscreen (unless handled by the host).
  // Listeners live on <video> directly so host events and the native context
  // menu are never blocked.
  setup_stage = () => {
    let signal = this.abort.signal

    this.video.addEventListener(`pointerdown`, (e) => {
      this.last_pointer_type = e.pointerType
    }, {signal})

    this.video.addEventListener(`dblclick`, (e) => {
      if (e.defaultPrevented) {
        return
      }

      this.clear_click_toggle()

      // If a slow double-click already fired the single-click toggle, undo it
      if (this.last_click_toggle && ((performance.now() - this.last_click_toggle) < 400)) {
        this.last_click_toggle = 0

        if (this.video.paused) {
          this.play()
        }
        else {
          this.pause()
        }
      }

      this.toggle_fullscreen()
    }, {signal})

    this.video.addEventListener(`click`, (e) => {
      if (e.defaultPrevented) {
        return
      }

      // On touch there is no hover, so a tap toggles the controls instead
      if ((e.pointerType === `touch`) || (this.last_pointer_type === `touch`)) {
        if (this.is_idle()) {
          this.show_controls()
          this.schedule_hide(this.options.hide_delay_idle)
        }
        else {
          this.clear_hide()
          this.hide_controls()
        }

        return
      }

      if (!this.options.click_to_play) {
        return
      }

      // Second click of a double-click cancels the pending play/pause toggle
      if (e.detail >= 2) {
        this.clear_click_toggle()
        return
      }

      // Wait briefly so double-clicking to fullscreen doesn't pause/resume playback
      this.clear_click_toggle()

      this.click_timeout = setTimeout(() => {
        this.click_timeout = undefined
        this.last_click_toggle = performance.now()
        this.toggle_play()
      }, 200)
    }, {signal})
  }

  // The big seekbar: click, drag, hover preview and sparks
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
      this.seek_dirty = true
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

      if (ratio !== this.drag_ratio) {
        this.drag_ratio = ratio
        this.seek_dirty = true
        this.request_seek()
        this.render_progress(ratio)
        this.trail(ratio)
      }
    })

    let end_drag = () => {
      if (!this.dragging_seek) {
        return
      }

      this.dragging_seek = false
      this.root.classList.remove(`pvp_seeking`)
      cancelAnimationFrame(this.seek_request)
      this.seek_request = undefined

      if (this.seek_dirty || (this.drag_ratio >= 1)) {
        this.apply_seek(true)
      }
      else {
        this.update_progress()
      }

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

    // Rewind and forward skip buttons flanking the play button
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

    this.els.time.addEventListener(`click`, () => {
      if (this.els.time.classList.contains(`pvp_showing_info`)) {
        this.hide_info()
        return
      }

      this.show_filename()
    })

    this.root.addEventListener(`fullscreenchange`, () => {
      this.update_fullscreen()
    })

    // A small light ripple on every button press, and return focus to the
    // player root after pointer clicks so Spacebar stays bound to play/pause
    for (let button of this.root.querySelectorAll(`.pvp_button, .pvp_vol_label, .pvp_time`)) {
      button.addEventListener(`pointerdown`, (e) => {
        this.ripple(button, e)
      })

      button.addEventListener(`click`, (e) => {
        if (e.detail > 0) {
          this.root.focus({preventScroll: true})
        }
      })
    }
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

    // Wheel anywhere on the volume area changes volume by one wheel step
    this.els.volume.addEventListener(`wheel`, (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        return
      }

      e.preventDefault()

      if (e.deltaY === 0) {
        return
      }

      let wheel_step = this.options.volume_step_wheel
      this.change_volume(e.deltaY < 0 ? wheel_step : -wheel_step)
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
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) {
        return
      }

      if (e.target.closest(`input, textarea, select, [contenteditable]`)) {
        return
      }

      let key = e.key.toLowerCase()
      let on_button = e.target.tagName === `BUTTON`
      let handled = true
      let show_ui = true

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
        show_ui = false
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
        e.stopPropagation()

        if (show_ui) {
          this.show_controls()
          this.schedule_hide(this.options.hide_delay_idle)
        }
      }
    })
  }

  // Controls appear on movement, hide after leaving the player or sitting
  // idle over the empty video area (never while hovering the controls).
  setup_autohide = () => {
    let signal = this.abort.signal

    // Track cursor position across the whole document so exiting fullscreen
    // knows whether the pointer is inside or outside the restored video box
    let track_pointer = (e) => {
      if (e.pointerType === `touch`) {
        return
      }

      this.has_pointer = true
      this.pointer_screen_x = e.screenX
      this.pointer_screen_y = e.screenY

      if (!this.is_fullscreen()) {
        this.viewport_offset_x = e.screenX - e.clientX
        this.viewport_offset_y = e.screenY - e.clientY
        this.has_viewport_offset = true
      }
    }

    document.addEventListener(`pointermove`, track_pointer, {signal})
    document.addEventListener(`pointerdown`, track_pointer, {signal})

    let control_areas = [
      this.els.panel,
      this.els.seek,
    ]

    for (let el of control_areas) {
      el.addEventListener(`pointerenter`, (e) => {
        if ((e.pointerType === `touch`) || (performance.now() < this.block_controls_until)) {
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

        if (!this.is_idle() && (this.pointer_inside || !this.hide_timeout)) {
          this.schedule_hide(this.options.hide_delay_idle)
        }
      })
    }

    this.root.addEventListener(`pointermove`, (e) => {
      // Touch "moves" while tapping, those are handled by the stage click
      if (e.pointerType === `touch`) {
        return
      }

      // Ignore movement briefly after entering fullscreen
      if (performance.now() < this.block_controls_until) {
        return
      }

      cancelAnimationFrame(this.restore_check_request)
      this.restore_check_request = undefined
      this.pointer_inside = true
      this.over_controls = Boolean(e.target.closest(`.pvp_panel, .pvp_seek`))
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

      // Don't restart if controls are already hidden or already on the quick leave timer
      if (this.is_idle() || (this.hide_timeout && (this.hide_delay <= this.options.hide_delay_leave))) {
        return
      }

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

  clear_click_toggle = () => {
    clearTimeout(this.click_timeout)
    this.click_timeout = undefined
  }

  toggle_play = () => {
    this.clear_click_toggle()

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
  // and waits for an in-flight decode instead of flooding the decoder
  request_seek = () => {
    if (this.seek_request) {
      return
    }

    this.seek_request = requestAnimationFrame(() => {
      this.seek_request = undefined

      if (!this.dragging_seek || !this.seek_dirty || this.video.seeking) {
        return
      }

      this.apply_seek(false)
    })
  }

  apply_seek = (final = true) => {
    this.seek_dirty = false
    let duration = this.video.duration
    let target = this.drag_ratio * duration

    // Avoid triggering "ended" mid-drag if the pointer brushes the right edge
    if (!final && Number.isFinite(duration) && (duration > 0.1) && (target >= duration)) {
      target = duration - 0.05
    }

    this.seek_to(target)
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

  // Debounce localStorage writes so host volume fades don't thrash storage
  schedule_save_volume = () => {
    if (!this.options.remember_volume) {
      return
    }

    clearTimeout(this.save_volume_timeout)

    this.save_volume_timeout = setTimeout(() => {
      this.save_volume_timeout = undefined
      this.save_volume()
    }, 250)
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
    this.update_buffer()
    this.start_frame_loop()
  }

  // Show controls immediately with no fade transition
  show_controls_immediately = () => {
    if (!this.is_idle()) {
      return
    }

    this.root.classList.add(`pvp_no_transition`)
    this.show_controls()
    void this.root.offsetWidth
    this.root.classList.remove(`pvp_no_transition`)
  }

  // Map the last known screen pointer coordinates back to windowed viewport space
  get_windowed_pointer = () => {
    if (!this.has_pointer || !this.has_viewport_offset) {
      return null
    }

    return {
      x: this.pointer_screen_x - this.viewport_offset_x,
      y: this.pointer_screen_y - this.viewport_offset_y,
    }
  }

  // Pick the right hide behavior after exiting fullscreen based on cursor position
  apply_restore_hide = () => {
    let pos = this.get_windowed_pointer()
    let inside = false
    let over = false

    if (pos) {
      let rect = this.video.getBoundingClientRect()

      let in_viewport = (
        (pos.x >= 0) &&
        (pos.x <= window.innerWidth) &&
        (pos.y >= 0) &&
        (pos.y <= window.innerHeight)
      )

      inside = in_viewport && (
        (pos.x >= rect.left) &&
        (pos.x <= rect.right) &&
        (pos.y >= rect.top) &&
        (pos.y <= rect.bottom)
      )

      if (inside) {
        let el = document.elementFromPoint(pos.x, pos.y)
        over = Boolean(el && this.root.contains(el) && el.closest(`.pvp_panel, .pvp_seek`))
      }
    }
    else {
      inside = this.root.matches(`:hover`)
      over = inside && Boolean(this.root.querySelector(`.pvp_panel:hover, .pvp_seek:hover`))
    }

    this.pointer_inside = inside
    this.over_controls = over

    if (over) {
      this.clear_hide()
    }
    else {
      let delay = inside ? this.options.hide_delay_idle : this.options.hide_delay_leave

      if (!this.hide_timeout || (this.hide_delay !== delay)) {
        this.schedule_hide(delay)
      }
    }
  }

  // Reveal controls right away when restoring from fullscreen, using the quick
  // leave delay if the cursor is already outside the player
  reveal_on_restore = () => {
    this.show_controls_immediately()
    this.apply_restore_hide()
    cancelAnimationFrame(this.restore_check_request)

    // Re-check once layout finishes settling after fullscreen exit
    this.restore_check_request = requestAnimationFrame(() => {
      this.restore_check_request = undefined

      if (!this.is_fullscreen() && !this.is_idle()) {
        this.apply_restore_hide()
      }
    })
  }

  hide_controls = (force = false) => {
    // Never hide during a drag, while resting on controls, or while LCD info holds controls open
    if (!force && (this.dragging_seek || this.dragging_volume || this.over_controls || this.holding_info)) {
      return
    }

    if (force) {
      this.over_controls = false
      this.release_info_hold(false)
    }

    this.clear_hide()
    this.root.classList.add(`pvp_idle`)
    this.stop_repeat()
  }

  // Hide controls immediately with no fade transition
  hide_controls_immediately = () => {
    this.root.classList.add(`pvp_no_transition`)
    this.hide_controls(true)
    void this.root.offsetWidth
    this.root.classList.remove(`pvp_no_transition`)
  }

  schedule_hide = (delay) => {
    this.clear_hide()
    this.hide_delay = delay

    this.hide_timeout = setTimeout(() => {
      this.hide_controls()
    }, delay)
  }

  clear_hide = () => {
    clearTimeout(this.hide_timeout)
    this.hide_timeout = undefined
    this.hide_delay = 0
  }

  // ---------------------------------------------------------------------
  // LCD info ticker
  // ---------------------------------------------------------------------

  get_filename = () => {
    if (`pvpTitle` in this.video.dataset) {
      let custom = this.video.dataset.pvpTitle.trim()

      if (custom) {
        return custom
      }
    }

    let source = this.video.querySelector(`source[src]`)
    let src = this.video.currentSrc || this.video.getAttribute(`src`) || (source ? source.getAttribute(`src`) : ``)
    return PerfectPlayer.extract_filename(src)
  }

  show_filename = () => {
    let name = this.get_filename()

    if (name) {
      this.show_info(name)
    }
  }

  // Temporarily show text in the center LCD display, scrolling once if it overflows
  show_info = (text) => {
    let content = String(text || ``).trim()

    if (!content) {
      return
    }

    this.clear_info_timers()
    this.show_controls()
    this.clear_hide()
    this.start_info_hold()
    let time = this.els.time
    let info = this.els.time_info
    let text_el = this.els.time_info_text
    text_el.style.transition = ``
    text_el.style.transform = ``
    info.style.justifyContent = ``
    text_el.textContent = content
    time.classList.add(`pvp_showing_info`)
    let overflow = Math.ceil(text_el.scrollWidth - info.clientWidth)

    if ((overflow <= 0) || this.reduced_motion) {
      if (overflow <= 0) {
        info.style.justifyContent = `center`
      }

      this.info_end_timeout = setTimeout(() => {
        this.info_end_timeout = undefined
        this.hide_info()
      }, 2500)

      return
    }

    info.style.justifyContent = `flex-start`
    let start_pause = 650
    let end_pause = 850
    let scroll_ms = Math.round(Math.max(1000, (overflow / 55) * 1000))

    this.info_start_timeout = setTimeout(() => {
      this.info_start_timeout = undefined
      text_el.style.transition = `transform ${scroll_ms}ms linear`
      text_el.style.transform = `translateX(${-overflow}px)`
    }, start_pause)

    this.info_end_timeout = setTimeout(() => {
      this.info_end_timeout = undefined
      this.hide_info()
    }, start_pause + scroll_ms + end_pause)
  }

  // Keep controls visible while LCD info is playing, capped at info_hide_block ms
  start_info_hold = () => {
    clearTimeout(this.info_hold_timeout)
    this.holding_info = true

    this.info_hold_timeout = setTimeout(() => {
      this.info_hold_timeout = undefined
      this.release_info_hold()
    }, this.options.info_hide_block)
  }

  release_info_hold = (resume_hide = true) => {
    clearTimeout(this.info_hold_timeout)
    this.info_hold_timeout = undefined

    if (!this.holding_info) {
      return
    }

    this.holding_info = false

    if (!resume_hide || this.is_idle() || this.over_controls || this.dragging_seek || this.dragging_volume) {
      return
    }

    let stay_open = this.pointer_inside || (this.last_pointer_type === `touch`)
    this.schedule_hide(stay_open ? this.options.hide_delay_idle : this.options.hide_delay_leave)
  }

  clear_info_timers = () => {
    clearTimeout(this.info_start_timeout)
    clearTimeout(this.info_end_timeout)
    this.info_start_timeout = undefined
    this.info_end_timeout = undefined
  }

  hide_info = (resume_hide = true) => {
    this.clear_info_timers()
    this.els.time.classList.remove(`pvp_showing_info`)
    this.els.time_info.style.justifyContent = ``
    this.els.time_info_text.style.transition = ``
    this.els.time_info_text.style.transform = ``
    this.els.time_info_text.textContent = ``
    this.release_info_hold(resume_hide)
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
    else {
      this.root.style.removeProperty(`--pvp_ratio`)
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
    ratio = PerfectPlayer.clamp(ratio, 0, 1)
    let percent = `${(ratio * 100).toFixed(3)}%`
    this.els.seek_fill.style.width = percent
    this.els.seek_thumb.style.setProperty(`--pvp_progress`, percent)
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
        end = Math.max(end, video.buffered.end(i))
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
    this.els.vol_label.textContent = this.video.muted ? `MUTE` : String(percent)
    this.els.vol_label.setAttribute(`aria-label`, this.video.muted ? `Unmute` : `Mute`)
    this.els.volume.classList.toggle(`pvp_muted`, muted)
    this.els.vol_down.disabled = percent === 0
    this.els.vol_up.disabled = percent === 100
  }

  update_fullscreen = () => {
    let full = this.is_fullscreen()
    let entered = full && !this.was_fullscreen
    let exited = !full && this.was_fullscreen
    this.was_fullscreen = full
    this.root.classList.toggle(`pvp_full`, full)

    if (this.els.fullscreen) {
      let icons = PerfectPlayer.icons
      this.els.fullscreen.innerHTML = full ? icons.fullscreen_exit : icons.fullscreen
      this.els.fullscreen.setAttribute(`aria-label`, full ? `Exit fullscreen` : `Fullscreen`)
    }

    this.sync_overlay()

    if (entered) {
      cancelAnimationFrame(this.restore_check_request)
      this.restore_check_request = undefined
      this.pointer_inside = false
      this.block_controls_until = performance.now() + this.options.fullscreen_hide_block
      this.hide_controls_immediately()
    }
    else if (exited) {
      this.block_controls_until = 0
      this.reveal_on_restore()
    }
    else if (!full) {
      this.block_controls_until = 0
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
    this.abort.abort()
    this.clear_hide()
    this.clear_click_toggle()
    this.hide_info(false)
    this.stop_repeat()
    clearTimeout(this.save_volume_timeout)
    cancelAnimationFrame(this.frame_request)
    cancelAnimationFrame(this.seek_request)
    cancelAnimationFrame(this.restore_check_request)

    if (this.resize_observer) {
      this.resize_observer.disconnect()
      this.resize_observer = undefined
    }

    if (this.mutation_observer) {
      this.mutation_observer.disconnect()
      this.mutation_observer = undefined
    }

    this.video.classList.remove(`pvp_video`)
    this.video.controls = true

    if (this.root.parentNode) {
      this.root.parentNode.insertBefore(this.video, this.root)
    }

    this.root.remove()
    PerfectPlayer.map.delete(this.video)
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
