/*
  Demo page logic: load a local file or a URL into the main player.
  The players themselves are created automatically by perfect_player.js
  because the <video> elements have the data-perfect-player attribute.
*/

const App = {}

App.init = () => {
  App.setup_loader()
}

// Swap the source of the main video
App.load_source = (src, title = ``) => {
  let video = document.querySelector(`#main_video`)
  video.removeAttribute(`poster`)

  if (title) {
    video.dataset.pvpTitle = title
  }
  else {
    delete video.dataset.pvpTitle
  }

  video.src = src
  video.play()
}

App.setup_loader = () => {
  document.querySelector(`#file_input`).addEventListener(`change`, (e) => {
    let file = e.target.files[0]

    if (file) {
      App.load_source(URL.createObjectURL(file), file.name)
    }
  })

  document.querySelector(`#url_input`).addEventListener(`keydown`, (e) => {
    let url = e.target.value.trim()

    if ((e.key === `Enter`) && url) {
      App.load_source(url)
    }
  })
}

window.onload = () => {
  App.init()
}

