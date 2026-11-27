# Perfect Video Player

A prototype of how web video players *should* work. It replaces the native
`<video>` controls with a layout designed around one idea: **you should never
seek by accident**.

![layout](https://img.shields.io/badge/seekbar-in%20the%20middle-3cb6ff) ![license](https://img.shields.io/badge/license-GPLv3-72ffa6)

## The problem

On most players the seekbar is a thin line glued to the bottom of the video,
right above the buttons. It's hard to grab, hard to drag, and when you aim for
the play or volume button you often land on the seekbar instead and jump to
some random point of the video.

## The layout

```
┌──────────────────────────────────────────────────────┐
│                       ( ▶ )                          │  ← play/pause feedback at the top
│  [« -1m] [« -5s]                    [+5s »] [+1m »]  │  ← quick skip buttons
│                                                      │
│   ━━━━━━━━━━━━━━━━━━━●───────────────────────────    │  ← big seekbar, in the middle
│                                                      │
│ ┌──────────────────────────────────────────────────┐ │
│ │ [ ▶ ] [ ⛶ ]      2:36 / 10:00        [-]━━●[+] 64% │ │  ← panel
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

## Strengths

- **Big seekbar in the middle of the video.** Easy to click, easy to drag,
  with a generous (but not huge) hit area, and far away from every button.
  Hovering shows a big, easy-to-read LCD timestamp above the bar.
- **Quick `-1m` / `-5s` and `+5s` / `+1m` buttons** well above the left and
  right ends of the seekbar (`-1m` / `+1m` on the outer edges), so you can jump
  back or forward without aiming on the track.
- **Big play/pause and fullscreen buttons** on the bottom left, matching in
  size, with a machined chrome bezel and glossy aqua core on play/pause.
- **Volume you can actually control precisely** on the bottom right:
  - a `-` button and a `+` button (4% steps, hold to repeat),
  - a regular clickable/draggable slider,
  - a label with the exact percentage (click it to mute),
  - mouse wheel over the volume area changes it by 4%.
  - The volume is remembered between visits.
- **Big, readable time** (`2:36 / 10:00`) in a green LCD readout in the
  middle of the panel.
- **No accidental pauses or misclicks.** Single-clicking the empty video area
  or the panel background does nothing; double-clicking either toggles
  fullscreen. Play/pause feedback pops cleanly near the top so the seekbar
  never blocks it.
- **Controls get out of the way.** They hide 0.5 seconds after the cursor
  leaves the player, or after 2 seconds without moving over the empty video
  area. They stay visible while the cursor rests on the bottom panel or
  seekbar, and never hide in the middle of a drag. The cursor hides too.
- **Looks good.** Glossy metal and glass inspired by Windows 98/XP, Winamp and
  FL Studio, kept clean and minimal.
- **Pleasant, but cheap, effects.** Sparks fly from the seekbar when you click
  or drag it, buttons ripple when pressed, the progress fill has a soft shine
  while playing, and a big icon pops when toggling playback. Effects only use
  `transform`/`opacity`, sparks are capped, and the progress animation loop
  only runs while the video plays *and* the controls are visible. Everything
  decorative turns off with `prefers-reduced-motion`.
- **Scales with the player.** Sizes use container query units, so a 400px
  player gets compact controls and a fullscreen one gets big ones.
- **Keyboard support** when the player is focused (see below).
- **No dependencies or build step.** Plain JS + CSS, plus the tiny
  [dom.js](https://github.com/madprops/dom) helper.

## Usage

Copy these files into your site:

```
css/main/perfect_player.css
js/libs/dom.js
js/main/perfect_player.js
```

Include them:

```html
<link rel="stylesheet" href="css/main/perfect_player.css">
<script src="js/libs/dom.js"></script>
<script src="js/main/perfect_player.js"></script>
```

### Automatic

Add `data-perfect-player` to any `<video>`. It gets upgraded when the DOM is
ready:

```html
<video data-perfect-player src="movie.mp4" poster="poster.jpg"></video>
```

Any `controls` attribute is removed. A numeric `width` attribute is kept as the
player width, otherwise the player fills the width of its parent and takes the
height from the video's aspect ratio.

### Manual

```js
let player = PerfectPlayer.upgrade(document.querySelector(`#my_video`), {
  volume_step: 5,
  hide_delay_idle: 2000,
})

player.play()
player.pause()
player.toggle_play()
player.seek_to(90)
player.set_volume(50)
player.toggle_mute()
player.toggle_fullscreen()

// The original element is still there, use it for anything else
player.video.addEventListener(`ended`, () => {})

// Put the plain <video> back
player.destroy()
```

Upgrade a custom selection:

```js
PerfectPlayer.upgrade_all(`.article video`)
```

### Options

| Option              | Default                 | Description                                         |
|---------------------|-------------------------|-----------------------------------------------------|
| `volume_step`       | `4`                     | Percent per button press, wheel tick or arrow key   |
| `seek_step`         | `5`                     | Seconds for `-5s`/`+5s` and left/right arrow keys   |
| `seek_step_long`    | `60`                    | Seconds for the `-1m`/`+1m` buttons                 |
| `hide_delay_leave`  | `500`                   | ms to hide controls after the cursor leaves         |
| `hide_delay_idle`   | `2000`                  | ms to hide controls after idle on empty video area  |
| `remember_volume`   | `true`                  | Save the volume in `localStorage`                   |
| `storage_key`       | `perfect_player_volume` | `localStorage` key for the volume                   |
| `fullscreen_button` | `true`                  | Show the small fullscreen button next to play       |
| `particles`         | `true`                  | Sparks on the seekbar                               |
| `keyboard`          | `true`                  | Keyboard shortcuts while focused                    |

Global defaults can be changed through `PerfectPlayer.defaults`.

### Keyboard

| Key                  | Action              |
|----------------------|---------------------|
| `Space` / `K`        | Play / Pause        |
| `←` / `→`            | Seek 5 seconds      |
| `J` / `L`            | Seek 10 seconds     |
| `↑` / `↓`            | Volume ±4%          |
| `M`                  | Mute                |
| `F`                  | Fullscreen          |
| `0`–`9`              | Jump to 0%–90%      |
| `Home` / `End`       | Start / End         |

### Theming

Every color and size is a CSS custom property on `.pvp`:

```css
.pvp {
  --pvp_accent_top: #ffd9b4;
  --pvp_accent_mid: #ff9a3c;
  --pvp_accent_low: #e06216;
  --pvp_accent_end: #a8420b;
  --pvp_glow: rgba(255, 150, 70, 0.6);
  --pvp_lcd_text: #ffcf5a;
}
```

## Files

| File                          | Purpose                                      |
|-------------------------------|----------------------------------------------|
| `js/main/perfect_player.js`   | The player (`PerfectPlayer` class)           |
| `css/main/perfect_player.css` | Player styles and theme variables            |
| `js/libs/dom.js`              | Small DOM helper library used by the player  |
| `index.html`                  | Demo page                                    |
| `js/main/demo.js`             | Demo page logic (local file / URL loader)    |
| `css/main/demo.css`           | Demo page styles                             |

## Demo

Open `index.html` in a browser, or serve the folder:

```sh
python -m http.server
```

> Note: seeking needs a server that supports HTTP Range requests (nginx,
> Apache, Caddy, most CDNs). Python's `http.server` doesn't support them, so
> seeking a video served by it jumps back to the start in Chrome. This affects
> any player, not just this one.

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari 16+). It relies on
pointer events, container queries and `backdrop-filter`.

## License

[MIT](LICENSE)
