'use strict'
const
	/** @type HTMLCanvasElement */
	canvas = document.getElementById("canvas"),
	ctx = canvas.getContext("2d", { desynchronized: true }), // test
	/** misc app properties */
	state = { //later
		/** pixel offset of canvas from topleft */
		dragOffset: [0, 0],
		zoom: 100,
	},
	shift = {
		/** @type HTMLButtonElement */
		b: document.getElementById("shift"),
		/** held down on keyboard */
		held: false,
		/** toggled via gui keyboard */
		toggled: false,
		get down() { return this.held || this.toggled }
	},
	grid = {
		x: 0, y: 0,
		/**
		 * half the number of pixels between
		 * the last peg and the end of the viewport
		 * only half is needed to center all pegs
		 */
		offsetX: 0,
		/** `grid.offsetX` Y axis edition */
		offsetY: 0,
		_gap: 15,
		set gap(n) { this._gap = Math.min(Math.max(n, 10), 20) },
		get gap() { return this._gap },
		visible: true,
		/**
		 * cached as image; everything gets rerendered on mousemove
		 * so use a cached image for grid unless resizing the canvas
		 * @type {?HTMLImageElement}
		 */
		img: null
	},
	render = {
		/** as an element */
		svg: document.createElementNS("http://www.w3.org/2000/svg", "svg"),
		/** @type {?HTMLImageElement} cached as image; same reason as `grid.img` */
		img: null,
		/** dimensions in pixels for rendering img */
		imgSize: null
	},
	cursor = { x: 0, y: 0 },
	/** svg path elements and data associated with them */
	paths = [
		{
			el: document.createElementNS("http://www.w3.org/2000/svg", "path"),
			/**
			 * linked list array
			 * should only have heads of segments + properties
			 * if this doesn't work out switch to a 2d array
			 * @type {{type: string, x: number, y: number, next: ?{}, prev: ?{}}[]}
			 */
			d: []
		}
	], // atm used in keyfns.line, drawrender, drawplacedpoints, buildsvg, mouse(up|down)
	/** points before they get added to the path */
	points = [],
	/** [0] = base layer; [1] = shift layer */
	keybinds = [
		{
			a: "line",
			// s: "arc",
			// d: "arc_rev",
			// f: "bezier_quad",
			// g: "bezier_cube",
			// z: "linecap",
			// x: "linejoin",
			// c: "close",
			// v: "fill",
			// rect: "z",
			// ellipse: "x",
		},
		{
			// a: "json",
			s: "svg",
			// d: "png",
			// f: "webp",
			// z: "undo",
			// x: "redo",
			// c: "crop",
			// v: "preview"
		}
	],
	/** fns that map to `keybinds` values */
	keyfns = {
		line: _ => {
			if (points.length < 2) return

			let tail = { x: points[0][0], y: points[0][1], type: "M" }
			currentPath.d.push(tail)
			let prev = tail
			for (let i = 1; i < points.length; i++) {
				tail.next = { x: points[i][0], y: points[i][1], type: "L" }
				tail = tail.next
				tail.prev = prev
				prev = tail
			}

			// currentPath.d.push([points[0][0], points[0][1], "M"])
			// for (let i = 1; i < points.length; i++) {
			// 	currentPath.d.push([points[i][0], points[i][1], "L"])
			// }
			points.length = 0
			render.img = null //TODO don't rebuild; add to svg path.d instead
			buildSVG()
			redraw()
		},
		svg: _ => exportRender("image/svg+xml"),
		// png: _ => exportRender("image/png"),
		// webp: _ => exportRender("image/webp")
	}

let
	clickdown,
	clickup, //TODO might remove
	currentPath = paths[0]

function drawGrid() {
	if (!grid.visible) return

	ctx.beginPath()
	const bigR = grid.gap * 4
	for (let x = grid.offsetX; x < canvas.width; x += grid.gap) {
		for (let y = grid.offsetY; y < canvas.height; y += grid.gap) {
			const r = x % bigR === grid.offsetX && y % bigR === grid.offsetY ? 2 : 1
			ctx.moveTo(x, y)
			ctx.arc(x, y, r, 0, 2 * Math.PI)
		}
	}
	ctx.fillStyle = "darkgrey"
	ctx.fill()
}

function drawRender() {
	if (render.img) return ctx.drawImage(
		render.img,
		grid.offsetX,
		grid.offsetY,
		render.imgSize.w,
		render.imgSize.h
	)
	if (paths.every(p => p.d.length === 0)) return //TODO better skip handler when no lines to draw

	//TODO turn svg to img but with size of canvas to avoid blurring (and replace render.imgSize)
	const s = new XMLSerializer().serializeToString(render.svg)
	const src = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }))
	// const src = `data:image/svg+xml;base64,${btoa(s)}` // Dotgrid's method
	// const src = `data:image/svg+xml,${encodeURIComponent(s)}`

	render.imgSize = { w: canvas.width - grid.offsetX * 2, h: canvas.height - grid.offsetY * 2 }
	render.img = new Image()
	render.img.onload = _ => {
		URL.revokeObjectURL(src)
		redraw()
	}
	render.img.src = src
}

function drawPreviewPoints() {
	ctx.beginPath()
	for (const point of points) {
		const x = point[0] * grid.gap + grid.offsetX
		const y = point[1] * grid.gap + grid.offsetY
		ctx.moveTo(x, y)
		ctx.arc(x, y, 3, 0, 2 * Math.PI)
	}
	ctx.fillStyle = "grey"
	ctx.fill()
}

function drawPlacedPoints() {
	for (let point of currentPath.d) {
		while (point) {
			const x = point.x * grid.gap + grid.offsetX
			const y = point.y * grid.gap + grid.offsetY
			ctx.beginPath()
			ctx.arc(x, y, grid.gap / 3, 0, 2 * Math.PI)
			ctx.fillStyle = "black"
			ctx.fill()
			ctx.beginPath()
			ctx.arc(x, y, grid.gap / 6, 0, 2 * Math.PI)
			ctx.fillStyle = "white"
			ctx.fill()
			point = point.next
		}
		// const x = point[0] * grid.gap + grid.offsetX
		// const y = point[1] * grid.gap + grid.offsetY
		// ctx.beginPath()
		// ctx.moveTo(x, y)
		// ctx.arc(x, y, grid.gap / 3, 0, 2 * Math.PI)
		// ctx.fillStyle = "black"
		// ctx.fill()
		// ctx.closePath()
		// ctx.beginPath()
		// ctx.arc(x, y, grid.gap / 6, 0, 2 * Math.PI)
		// ctx.fillStyle = "white"
		// ctx.fill()
	}
}

function drawCursor() {
	const x = cursor.x * grid.gap + grid.offsetX
	const y = cursor.y * grid.gap + grid.offsetY
	ctx.beginPath()
	ctx.moveTo(x + grid.gap / 2, y)
	ctx.arc(x, y, grid.gap / 2, 0, 2 * Math.PI)
	ctx.stroke()
}

function draw() {
	drawGrid()
	drawRender()
	drawPreviewPoints()
	drawPlacedPoints()
	drawCursor()
}

function redraw() {
	canvas.width = canvas.width
	draw()
}

//TODO don't build after every action; just add new points as needed
// only handles one path atm
function buildSVG() {
	render.svg.setAttribute("viewBox", `0 0 ${grid.x} ${grid.y}`) //MAYBE cache viewbox in var for other uses
	render.svg.innerHTML = ""

	currentPath.el ||= document.createElementNS("http://www.w3.org/2000/svg", "path")
	//TODO insert at correct index
	if (!render.svg.contains(currentPath.el)) render.svg.appendChild(currentPath.el)

	let d = ""
	for (let point of currentPath.d) {
		while (point) {
			d += `${point.type}${point.x} ${point.y}`
			point = point.next
		}
	}
	currentPath.el.setAttribute("d", d)

	// const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
	// let d = ""
	// for (const point of currentPath.d) {
	// 	d += `${point[2]}${point[0]} ${point[1]}`
	// }
	// path.setAttribute("d", d)
	// // if (currentPath.stroke) p.setAttribute("stroke", currentPath.stroke)
	// // if (currentPath.strokeWidth) p.setAttribute("stroke-width", currentPath.strokeWidth)
	// // if (currentPath.fill) p.setAttribute("fill", "none", currentPath.fill)
	// render.svg.appendChild(path)
}

/** assumes render.(svg|img) is built before reaching this method */
// currently only exports svg properly
function exportRender(type = "image/svg+xml") {
	const s = new XMLSerializer().serializeToString(render.svg)
	const a = document.createElement("a")
	a.download = `pegboard-${new Date().getTime()}`
	a.href = URL.createObjectURL(new Blob([s], { type }))
	a.click()
	URL.revokeObjectURL(a.href)
	// export to webp/png
	//TODO put render.img in canvas -> turn canvas into img -> dl img
	// const c = document.createElement("canvas")
	// const cc = c.getContext("2d")
	// c.width = render.img.naturalWidth
	// c.height = render.img.naturalHeight
	// cc.drawImage(render.img, 0, 0)
	// c.toBlob()
}

function setKeybindLayer(l) {
	for (const k of "qwertasdfgzxcvb") {
		const b = document.getElementById(k)
		if (keybinds[l][k]) {
			b.title = keybinds[l][k]
			b.disabled = false
		} else {
			b.removeAttribute("title")
			b.disabled = true
		}
	}
}

function keydown(e) {
	if (e.repeat) return
	const k = e.key.toLowerCase()

	switch (k) {
		case "shift":
			if (e.gui) {
				if (shift.held) return

				if (shift.toggled) {
					shift.b.classList.remove("active")
					setKeybindLayer(0)
				} else {
					shift.b.classList.add("active")
					setKeybindLayer(1)
				}
				shift.toggled = !shift.toggled
			} else {
				shift.held = true
				shift.b.classList.add("active")
				setKeybindLayer(1)
			}
			break
		case "escape":
			points.length = 0
			redraw()
			break
		default:
			const f = keybinds[shift.down ? 1 : 0][k]
			if (f) keyfns[f]()
	}
}

function keyup(e) {
	switch (e.key.toLowerCase()) {
		case "shift":
			shift.held = shift.toggled = false
			shift.b.classList.remove("active")
			setKeybindLayer(0)
			break
	}
}

function resize() {
	canvas.width = window.innerWidth
	canvas.height = window.innerHeight
	grid.x = Math.trunc(canvas.width / grid.gap)
	grid.y = Math.trunc(canvas.height / grid.gap)
	// offsets pegs from top-left so that they are centered in the viewport
	grid.offsetX = Math.trunc(canvas.width % grid.gap / 2)
	grid.offsetY = Math.trunc(canvas.height % grid.gap / 2)
	buildSVG()  //TODO change ctx.drawImage() dimension args instead
	draw()
}

function wheel(e) {
	grid.gap += e.deltaY < 0 ? 1 : -1

	//TODO this is inefficient
	render.img = null
	buildSVG()
	resize()
}

function mousemove(e) {
	const x = Math.trunc((e.clientX + grid.gap / 2 - grid.offsetX) / grid.gap)
	const y = Math.trunc((e.clientY + grid.gap / 2 - grid.offsetY) / grid.gap)

	if (cursor.x != x || cursor.y != y) {
		cursor.x = x
		cursor.y = y
		redraw()
	}
}

function mousedown(e) {
	if (clickdown) return
	clickdown = { x: cursor.x, y: cursor.y, b: e.button }

	//TODO change point coord storage (2d array or sumn)
	for (let point of currentPath.d) {
		while (point) {
			if (point.x === cursor.x && point.y === cursor.y) {
				clickdown.points ||= []
				clickdown.points.push(point)
			}
			point = point.next
		}
	}
	// for (const point of currentPath.d) {
	// 	if (point[0] === cursor.x && point[1] === cursor.y) {
	// 		clickdown.points ||= []
	// 		clickdown.points.push(point)
	// 	}
	// }
}

function mouseup(e) {
	if (!clickdown) return
	if (clickdown.b != e.button) return
	clickup = { x: cursor.x, y: cursor.y, b: e.button }

	switch (e.button) {
		case 0:
			if (clickup.x === clickdown.x && clickup.y === clickdown.y ||
				!clickdown.points) {
				points.push([cursor.x, cursor.y])
				ctx.beginPath()
				const x = cursor.x * grid.gap + grid.offsetX
				const y = cursor.y * grid.gap + grid.offsetY
				ctx.arc(x, y, 3, 0, 2 * Math.PI)
				ctx.fillStyle = "grey"
				ctx.fill()
				break
			}

			for (const point of clickdown.points) {
				point.x = clickup.x
				point.y = clickup.y
				// point[0] = clickup.x
				// point[1] = clickup.y
			}
			render.img = null
			buildSVG()
			redraw()
			break
		case 2: //TODO still broken
			if (clickdown.points) {
				for (let point of currentPath.d) {
					while (point) {
						if (clickdown.points.includes(point)) {
							if (point.type === "M") {
								if (point.next) {
									point.next.type = "M"
									const i = currentPath.d.indexOf(point)
									currentPath.d.splice(i, 1, point.next)
								} else {
									currentPath.d.pop(point)
								}
							}
							if (point.next) point.next.prev = point.prev
							if (point.prev) point.prev.next = point.next
						}
						point = point.next
					}
				}
				// currentPath.d = currentPath.d.filter(point => !clickdown.points.includes(point))
				render.img = null
				buildSVG()
				redraw()
			}
			break
	}

	clickdown = null
}

window.addEventListener("keydown", keydown)
window.addEventListener("keyup", keyup)
window.addEventListener("resize", resize)

canvas.addEventListener("wheel", wheel)
canvas.addEventListener("mousemove", mousemove)
canvas.addEventListener("mousedown", mousedown)
canvas.addEventListener("mouseup", mouseup)
canvas.addEventListener("contextmenu", e => e.preventDefault())

//STARTUP STUFF
setKeybindLayer(0)
resize()

render.svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
render.svg.setAttribute("stroke", "#000")
render.svg.setAttribute("fill", "none")
