const debug = document.createElement("pre")
debug.style.background = "white"
debug.innerHTML = `DEBUG
client pos <b id="debugclientpos"></b>
cursor pos <b id="debugcursorpos"></b>
clickdown  <b id="debugcursordown"></b>
clickup    <b id="debugcursorup"></b>
keydown    <b id="debugkeydown"></b>
preview points
<b id="debugpreviewpoints"></b>
current path
<b id="debugcurrentpath"></b>
`
document.querySelector("aside").appendChild(debug)

canvas.addEventListener("mousemove", e => {
  debugclientpos.textContent = `${e.clientX},${e.clientY}`
  debugcursorpos.textContent = `${cursor.x},${cursor.y}`
})

canvas.addEventListener("mousedown", () => {
  debugcursordown.textContent = `${clickdown.x},${clickdown.y} b ${clickdown.b}`
})

canvas.addEventListener("mouseup", () => {
  debugcursorup.textContent = `${clickup.x},${clickup.y} b ${clickup.b}`
  debugpreviewpoints.textContent = JSON.stringify(points).replaceAll("],", "\n")
})

window.addEventListener("keydown", (e) => {
  debugkeydown.textContent = e.key
  switch (e.key.toLowerCase()) {
    case "a":
      debugpreviewpoints.textContent = JSON.stringify(points).replaceAll("],", "\n")
      // debugcurrentpath.innerHTML = JSON.stringify(currentPath)
      //   .replaceAll(/,(?=[^,]*:)/g, "\n")
      //   .replaceAll("],", "\n")
      break
    case "escape":
      debugpreviewpoints.textContent = null
      break
  }
})
