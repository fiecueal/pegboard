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
			 * every element is a separate "M" segment under the same path
			 * always `d[n][0] === "M"`
			 * @type {{x: number, y: number, type: string}[][]}
			 */
			d: [] //TODO "Z" command toggle for every "M" segment
		}
	],
	/** points before they get added to the path */
	points = [],
	/** [0] = base layer; [1] = shift layer */
	keybinds = [
		{
			t: "width_up",
			a: "line",
			s: "arc",
			d: "bezier_quad",
			f: "bezier_cube",
			g: "width_down",
			z: "linecap",
			x: "linejoin",
			// c: "close",
			// v: "fill",
			// rect: "z",
			// ellipse: "x",
		},
		{
			// a: "json",
			t: "layer_up",
			s: "svg",
			g: "layer_down"
			// d: "png",
			// f: "webp",
			// z: "undo",
			// x: "redo",
			// c: "crop",
			// v: "preview"
		}
	],
	/** fns that map to `keybinds` values */
	commands = {
		//STROKES
		line: _ => points.length > 1 && addSegment("L"),
		arc: _ => points.length > 1 && addSegment("A"),
		bezier_quad: _ => points.length > 2 && points.length % 2 !== 0 && addSegment("Q", 2),
		bezier_cube: _ => points.length > 3 && (points.length - 1) % 3 === 0 && addSegment("C", 3),
		//STROKE STYLES
		linecap: _ => {
			const prev = currentPath.el.getAttribute("stroke-linecap")
			if (!prev) currentPath.el.setAttribute("stroke-linecap", "round")
			else if (prev === "round") currentPath.el.setAttribute("stroke-linecap", "square")
			else if (prev === "square") currentPath.el.removeAttribute("stroke-linecap")
			render.img = null
			draw()
		},
		linejoin: _ => {
			const prev = currentPath.el.getAttribute("stroke-linejoin")
			if (!prev) currentPath.el.setAttribute("stroke-linejoin", "miter-clip")
			else if (prev === "miter-clip") currentPath.el.setAttribute("stroke-linejoin", "round")
			else if (prev === "round") currentPath.el.setAttribute("stroke-linejoin", "arcs")
			else if (prev === "arcs") currentPath.el.setAttribute("stroke-linejoin", "bevel")
			else if (prev === "bevel") currentPath.el.removeAttribute("stroke-linejoin")
			render.img = null
			draw()
		},
		width_up: _ => stroke_width(1),
		width_down: _ => stroke_width(-1),
		//EXPORTS
		svg: _ => saveAs("image/svg+xml"),
		// png: _ => saveAs("image/png"),
		// webp: _ => saveAs("image/webp")
		// json: _ => saveAs("json")
		//TODO add/rm new paths in proper order
		//TODO handle skipping empty layers
		layer_up: _ => setPathLayer(1),
		layer_down: _ => setPathLayer(-1),
	}

let
	guiHidden = false,
	clickdown,
	clickup, //TODO might remove
	currentLayer = 0,
	currentPath = paths[0]

function toggleGUI() {
	if (guiHidden) {
		for (const c of document.querySelector("aside").children) {
			c.classList.remove("hide")
		}
	} else {
		for (const c of document.querySelector("aside").children) {
			c.classList.add("hide")
		}
	}

	guiHidden = !guiHidden
}

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
		URL.revokeObjectURL(src)//revoke later to prevent img stutter
		draw()
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
	for (const segment of currentPath.d) {
		for (const point of segment) {
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
		}
	}
}

function drawCursor() {
	const x = cursor.x * grid.gap + grid.offsetX
	const y = cursor.y * grid.gap + grid.offsetY
	ctx.beginPath()
	ctx.arc(x, y, grid.gap / 2, 0, 2 * Math.PI)
	ctx.stroke()
	ctx.beginPath()
	ctx.arc(x, y, grid.gap / 3, 0, 2 * Math.PI)
	ctx.strokeStyle = "#fff"
	ctx.lineWidth = 2
	ctx.stroke()
}

function draw() {
	canvas.width = canvas.width
	drawGrid()
	drawRender()
	drawPreviewPoints()
	drawPlacedPoints()
	drawCursor()
}

/** count = control points + end point */
function addSegment(type, count = 1) {
	const segment = [{ x: points[0][0], y: points[0][1], type: "M" }]
	for (let i = 1; i < points.length; i++) {
		segment.push({ x: points[i][0], y: points[i][1], type: `${type}${i % count}` })
	}
	currentPath.d.push(segment)

	points.length = 0
	render.img = null //TODO don't rebuild; add to svg path.d instead
	buildSVG()
	draw()
}

//TODO don't build after every action; just add new points as needed; goal: only call before exporting
//TODO proper layer addition and removal
// only handles one path atm
function buildSVG() {
	render.svg.setAttribute("viewBox", `0 0 ${grid.x} ${grid.y}`) //MAYBE cache viewbox in var for other uses
	//TODO insert paths at correct index instead of clearing each build
	render.svg.innerHTML = ""

	for (const path of paths) {
		render.svg.appendChild(path.el)
		let d = ""
		for (const segment of path.d) {
			for (let i = 0; i < segment.length; i++) {
				let point = segment[i]
				switch (point.type) {
					case "M":
					case "L0":
					case "Q1":
					case "C1":
						d += `${point.type[0]}${point.x} ${point.y}`
						break
					case "A0":
						const x = Math.abs(segment[i - 1].x - point.x) //TODO default values; make user-moddable
						const y = Math.abs(segment[i - 1].y - point.y)
						d += `A${x} ${y} 0 0 0 ${point.x} ${point.y}` //TODO moddable nums
						break
					case "Q0":
					case "C2":
					case "C0":
						d += ` ${point.x} ${point.y}`
						break
					default:
						console.log("bad point.type")
				}
			}
		}
		path.el.setAttribute("d", d)
	}
}

function stroke_width(n) {
	const prev = currentPath.el.getAttribute("stroke-width")
	const curr = parseInt(prev) + n
	if (curr > 1) currentPath.el.setAttribute("stroke-width", curr)
	else currentPath.el.removeAttribute("stroke-width")
	if (currentPath.el.getAttribute("stroke-width") !== prev) {
		render.img = null
		draw()
	}
}

/** assumes render.(svg|img) is built before reaching this method */
// currently only exports svg properly
function saveAs(type) {
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

function setPathLayer(d) {
	currentLayer = Math.max(currentLayer + d, 0)
	currentLayer += 1
	paths[currentLayer] ||= { el: document.createElementNS("http://www.w3.org/2000/svg", "path"), d: [] }
	currentPath = paths[currentLayer]
	render.svg.appendChild(currentPath.el)
	draw()
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
			draw()
			break
		default:
			const f = keybinds[shift.down ? 1 : 0][k]
			if (f) commands[f]()
	}
}

function keyup(e) {
	if (e.key !== "Shift") return
	shift.held = shift.toggled = false
	shift.b.classList.remove("active")
	setKeybindLayer(0)
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

	if (cursor.x !== x || cursor.y !== y) {
		cursor.x = x
		cursor.y = y
		draw()
	}
}

function mousedown(e) {
	if (clickdown) return
	clickdown = { x: cursor.x, y: cursor.y, b: e.button }

	for (const segment of currentPath.d) {
		for (const point of segment) {
			if (point.x === cursor.x && point.y === cursor.y) {
				clickdown.points ||= []
				clickdown.points.push(point)
			}
		}
	}
}

function mouseup(e) {
	if (!clickdown) return
	if (clickdown.b !== e.button) return
	clickup = { x: cursor.x, y: cursor.y, b: e.button } //MAYBE delete clickup (redundant)

	switch (e.button) {
		case 0:
			if (clickup.x === clickdown.x && clickup.y === clickdown.y || !clickdown.points) {
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
			}
			render.img = null
			buildSVG()
			draw()
			break
		case 2: //TODO not broken but it looks atrocious
			if (!clickdown.points) break

			let p
			while (p = clickdown.points.pop()) {
				for (const segment of currentPath.d) {
					if (!segment.includes(p)) continue

					const i = segment.indexOf(p)
					if (p.type === "M" && segment[1]) { // p = segment[0]
						if (segment[1].type === "Q1") segment[2].type = "A0"
						if (segment[1].type === "C1") {
							segment[2].type = "Q1"
							segment[3].type = "Q0"
						}
						segment[1].type = "M"
					} else if (p.type === "Q1") {
						segment[i + 1].type = "A0"
					} else if (p.type === "Q0") {
						segment[i - 1].type = "A0"
					} else if (p.type === "C1") {
						segment[i + 1].type = "Q1"
						segment[i + 2].type = "Q0"
					} else if (p.type === "C2") {
						segment[i - 1].type = "Q1"
						segment[i + 1].type = "Q0"
					} else if (p.type === "C0") {
						segment[i - 2].type = "Q1"
						segment[i - 1].type = "Q0"
					}
					segment.splice(i, 1)
					break
				}
			}

			render.img = null
			buildSVG()
			draw()
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
