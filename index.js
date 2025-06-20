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
			q: "width_up",
			w: "stroke_opacity_up",
			e: "fill_opacity_up",
			r: "bezier_quad",
			t: "bezier_cube",
			a: "width_down",
			s: "stroke_opacity_down",
			d: "fill_opacity_down",
			f: "line",
			g: "arc",
			z: "linecap",
			x: "linejoin",
			c: "fillrule",
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
		linecap: _ => cycleAttrOpts("stroke-linecap", ["butt", "round", "square"]),
		linejoin: _ => cycleAttrOpts("stroke-linejoin", ["miter", "miter-clip", "round", "arcs", "bevel"]),
		fillrule: _ => cycleAttrOpts("fill-rule", ["nonzero", "evenodd"]),
		width_up: _ => updateWidth(1),
		width_down: _ => updateWidth(-1),
		stroke_opacity_up: _ => updateOpacity("stroke-opacity", 10),
		stroke_opacity_down: _ => updateOpacity("stroke-opacity", -10),
		fill_opacity_up: _ => updateOpacity("fill-opacity", 10),
		fill_opacity_down: _ => updateOpacity("fill-opacity", -10),
		//EXPORTS
		svg: _ => saveAs("image/svg+xml"),
		// png: _ => saveAs("image/png"),
		// webp: _ => saveAs("image/webp")
		// json: _ => saveAs("json")
		//TODO add/rm new paths in proper order
		//TODO handle skipping empty layers
		layer_up: _ => setPathLayer(1),
		layer_down: _ => setPathLayer(-1),
	},
	guiHidden = { all: false, keyboard: false, pathdata: false, tutorial: false }

let
	clickdown,
	clickup, //TODO might remove
	currentLayer = 0,
	currentPath = paths[0]

function toggleGUI(id) {
	if (id === "all") {
		const fn = guiHidden.all ? "remove" : "add"
		for (const el of document.getElementById("gui").children) {
			el.classList[fn]("hide")
		}

		const flip = !guiHidden.all
		for (const key in guiHidden) {
			guiHidden[key] = flip
		}
		return
	}
	if (guiHidden[id]) document.getElementById(id).classList.remove("hide")
	else document.getElementById(id).classList.add("hide")

	guiHidden[id] = !guiHidden[id]
}

function drawGrid() {
	if (!grid.visible) return
	if (grid.img) return ctx.drawImage(grid.img, 0, 0)

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

	canvas.toBlob(blob => {
		const src = URL.createObjectURL(blob)
		grid.img = new Image()
		grid.img.onload = _ => URL.revokeObjectURL(src)
		grid.img.src = src
	})
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

function stringifySegment(segment) {
	let d = ""
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
				d += `A${x} ${y} 0 0 0 ${point.x} ${point.y}`
				break
			case "Q0":
			case "C2":
			case "C0":
				d += ` ${point.x} ${point.y}`
				break
			default:
				console.log("bad point type: " + JSON.stringify(point))
		}
	}
	return d
}

/** count = control points + end point for beziers */
function addSegment(type, count = 1) {
	const segment = [{ x: points[0][0], y: points[0][1], type: "M" }]
	for (let i = 1; i < points.length; i++) {
		segment.push({ x: points[i][0], y: points[i][1], type: `${type}${i % count}` })
	}
	currentPath.d.push(segment)

	points.length = 0
	currentPath.el.setAttribute(
		"d",
		(currentPath.el.getAttribute("d") || "") + stringifySegment(segment)
	)
	render.img = null
	draw()
}

//TODO don't build after every action; just add new points as needed; goal: only call before exporting
//TODO proper layer addition and removal
function buildSVG() {
	render.svg.setAttribute("viewBox", `0 0 ${grid.x} ${grid.y}`) //MAYBE cache viewbox in var for other uses
	//TODO insert paths at correct index instead of clearing each build
	render.svg.innerHTML = ""

	for (const path of paths) {
		render.svg.appendChild(path.el)
		let d = ""
		for (const segment of path.d) {
			d += stringifySegment(segment)
		}
		path.el.setAttribute("d", d)
	}
}

function cycleAttrOpts(attr, opts) {
	const prev = currentPath.el.getAttribute(attr) || opts[0]
	const next = opts[(opts.indexOf(prev) + 1) % opts.length]

	if (next === opts[0]) currentPath.el.removeAttribute(attr)
	else currentPath.el.setAttribute(attr, next)

	document.getElementById(attr).value = next

	render.img = null
	draw()
}

function updateWidth(n) {
	const prev = parseInt(currentPath.el.getAttribute("stroke-width")) || 1
	const next = Math.max(prev + n, 1)

	if (next > 1) currentPath.el.setAttribute("stroke-width", next)
	else currentPath.el.removeAttribute("stroke-width")

	document.getElementById("stroke-width").value = next

	if (next !== prev) {
		render.img = null
		draw()
	}
}

function updateOpacity(attr, n) {
	let prev = parseFloat(currentPath.el.getAttribute(attr)) * 100
	// js bruh moment: 0 is falsy
	if (prev !== 0) prev ||= 100
	const next = Math.min(Math.max(prev + n, 0), 100)

	if (next < 100) currentPath.el.setAttribute(attr, next / 100)
	else currentPath.el.removeAttribute(attr)

	document.getElementById(attr).value = next

	if (next !== prev) {
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
	if (e.target?.tagName === "INPUT") return
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
	if (e.target?.tagName === "INPUT") return
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
	//MAYBE set offset static instead
	grid.offsetX = Math.trunc(canvas.width % grid.gap / 2)
	grid.offsetY = Math.trunc(canvas.height % grid.gap / 2)
	buildSVG()  //TODO change ctx.drawImage() dimension args instead
	grid.img = null
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
			buildSVG()
			render.img = null
			draw()
			break
		case 2: //TODO not broken but it looks atrocious
			if (!clickdown.points) break

			let p
			while (p = clickdown.points.pop()) {
				for (const segment of currentPath.d) {
					if (!segment.includes(p)) continue

					const i = segment.indexOf(p)
					switch (p.type) {
						case "M":
							if (!segment[1]) break
							if (segment[1].type === "Q1") segment[2].type = "A0"
							else if (segment[1].type === "C1") {
								segment[2].type = "Q1"
								segment[3].type = "Q0"
							}
							segment[1].type = "M"
							break
						case "Q1":
							segment[i + 1].type = "A0"
							break
						case "Q0":
							segment[i - 1].type = "A0"
							break
						case "C1":
							segment[i + 1].type = "Q1"
							segment[i + 2].type = "Q0"
							break
						case "C2":
							segment[i - 1].type = "Q1"
							segment[i + 1].type = "Q0"
							break
						case "C0":
							segment[i - 2].type = "Q1"
							segment[i - 1].type = "Q0"
					}
					segment.splice(i, 1)
					break
				}
			}

			buildSVG()
			render.img = null
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

render.svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
render.svg.setAttribute("stroke", "#000") //MAYBE delete or handle default path values better
render.svg.setAttribute("fill", "none")

for (const el of document.getElementById("pathdata").children) {
	if (el.tagName !== "LABEL") continue

	const attr = el.getAttribute("for")
	const input = document.getElementById(attr)

	if (input.tagName === "SELECT") input.addEventListener("change", _ => {
		if (input.selectedOptions[0].defaultSelected) currentPath.el.removeAttribute(attr)
		else currentPath.el.setAttribute(attr, input.value)

		render.img = null
		draw()
	})

	else input.addEventListener("input", _ => {
		if (!input.checkValidity()) return

		if (input.value === input.defaultValue) currentPath.el.removeAttribute(attr)
		else switch (input.dataset.numtype) {
			case "rgb":
				currentPath.el.setAttribute(attr, "#" + input.value)
				break
			case "width":
				currentPath.el.setAttribute(attr, parseInt(input.value))
				break
			case "opacity":
				currentPath.el.setAttribute(attr, parseInt(input.value) / 100)
		}

		render.img = null
		draw()
	})
}

setKeybindLayer(0)
resize()
