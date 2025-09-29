'use strict'
const
	/** @type HTMLCanvasElement */
	canvas = document.getElementById("canvas"),
	ctx = canvas.getContext("2d", {desynchronized: true}), // test
	/** misc app properties */
	// state = { //later
	// 	/** pixel offset of canvas from topleft */
	// 	dragOffset: [0, 0],
	// 	zoom: 100,
	// },
	shift = {
		/** @type HTMLButtonElement */
		b: document.getElementById("shift"),
		/** held down on keyboard */
		held: false,
		/** toggled via gui keyboard */
		toggled: false,
		get down() {return this.held || this.toggled}
	},
	grid = {
		x: 0, y: 0,
		/**
		 * half the number of pixels between
		 * the last peg and the end of the viewport
		 * only half is needed to center all pegs
		 */
		offsetX: 0, //TODO set static instead of changing on resize
		/** `grid.offsetX` Y axis edition */
		offsetY: 0,
		_gap: 15, //MAYBE infinite zoom... somehow
		set gap(n) {this._gap = Math.min(Math.max(n, 10), 20)},
		get gap() {return this._gap},
	},
	render = {
		/** as an element */
		svg: document.createElementNS("http://www.w3.org/2000/svg", "svg"),
		/** show/hide dots to preview what the downloaded svg looks like */
		preview: false
	},
	drawCache = {
		grid: null,
		render: null,
	},
	cursor = {x: 0, y: 0},
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
	/** @type {[number, number][]} preview points before they get added to the path */
	previewPoints = [],
	guiHidden = {all: false, keyboard: false, pathdata: false, tutorial: false},
	/**
	 * [0] = base
	 * [1] = shift
	 *
	 * condition also used in other methods like `setKeybindLayer`
	 */
	keybinds = [
		{
			q: {text: "raise stroke width", command() {updateWidth(1)}, condition: _ => true},
			w: {text: "raise stroke opacity", command() {updateOpacity("stroke-opacity", 10)}, condition: _ => opacityCondition("stroke-opacity", "<")},
			e: {text: "raise fill opacity", command() {updateOpacity("fill-opacity", 10)}, condition: _ => opacityCondition("fill-opacity", "<")},

			r: {text: "draw bezier quad", command() {addSegment(currentPath, segmentifyPoints("Q", 2))}, condition: _ => previewPoints.length > 2 && previewPoints.length % 2 !== 0},
			t: {text: "draw bezier cube", command() {addSegment(currentPath, segmentifyPoints("C", 3))}, condition: _ => previewPoints.length > 3 && (previewPoints.length - 1) % 3 === 0},

			a: {text: "lower stroke width", command() {updateWidth(-1)}, condition: _ => (parseInt(currentPath.el.getAttribute("stroke-width")) || 1) > 1},
			s: {text: "lower stroke opacity", command() {updateOpacity("stroke-opacity", -10)}, condition: _ => opacityCondition("stroke-opacity", ">")},
			d: {text: "lower fill opacity", command() {updateOpacity("fill-opacity", -10)}, condition: _ => opacityCondition("fill-opacity", ">")},

			f: {text: "draw line", command() {addSegment(currentPath, segmentifyPoints("L"))}, condition: _ => previewPoints.length > 1},
			g: {text: "draw arc", command() {addSegment(currentPath, segmentifyPoints("A"))}, condition: _ => previewPoints.length > 1},

			//TODO simplify to only need attr param
			z: {text: "cycle linecap", command() {cycleAttrOpts("stroke-linecap", ["butt", "round", "square"])}, condition: _ => true},
			x: {text: "cycle linejoin", command() {cycleAttrOpts("stroke-linejoin", ["miter", "miter-clip", "round", "arcs", "bevel"])}, condition: _ => true},
			c: {text: "cycle fillrule", command() {cycleAttrOpts("fill-rule", ["nonzero", "evenodd"])}, condition: _ => true},
		},
		{
			t: {text: "move up one layer", command() {setCurrentPath(currentLayer + 1)}, condition: _ => true},

			s: {text: "save as svg", command() {saveAs("image/svg+xml")}, condition: _ => true},
			// d: "png",
			// f: "webp",

			g: {text: "move down one layer", command() {setCurrentPath(currentLayer - 1)}, condition: _ => currentLayer > 0},

			z: {text: "undo", command() {timeline.undo()}, condition: _ => timeline.index > 0},
			x: {text: "redo", command() {timeline.redo()}, condition: _ => timeline.index < timeline.stack.length},

			// c: "crop",
			c: {text: "clear layer", command() {replacePath(currentPath, [])}, condition: _ => currentPath.d.length > 0},
			v: {text: "toggle preview", command() {togglePreview()}, condition: _ => true},
		}
	],
	//MAYBE size limit on stack
	timeline = {//TODO catchall default case for actions with similar args
		stack: [], index: 0,

		track(action, ...args) {
			this.stack.splice(this.index)
			switch(action) {
				case "addSegment":
					this.stack.push({action, path: args[0], segment: args[1]})
					break
				case "rmPoints":
					this.stack.push({action, path: args[0], points: args[1]})
					break
				case "movePoints":
					this.stack.push({action, points: args[0], oldPos: args[1], newPos: args[2]})
					break
				case "replacePath": // args: layer, path
					this.stack.push({action, path: args[0], oldD: args[1], newD: args[2]})
					break
			}
			this.index++
			// console.log("track")
			// console.log(`stack: ${this.stack}`)
			// console.log(`index: ${this.index}`)
		},

		undo() {
			const a = this.stack[this.index - 1]
			switch(a.action) {
				case "addSegment":
					rmSegment(a.path, a.segment, true)
					break
				case "rmPoints":
					reattachPoints(a.points)
					break
				case "movePoints":
					movePoints(a.points, a.oldPos, true)
					break
				case "replacePath":
					replacePath(a.path, a.oldD, true)
					break
			}
			this.index--
			// console.log("undo")
			// console.log(`stack: ${this.stack}`)
			// console.log(`index: ${this.index}`)
		},

		redo() {
			const a = this.stack[this.index]
			switch(a.action) {
				case "addSegment":
					addSegment(a.path, a.segment, true)
					break
				case "rmPoints":
					rmPoints(a.path, a.points, true)
					break
				case "movePoints":
					movePoints(a.points, a.newPos, true)
					break
				case "replacePath":
					replacePath(a.path, a.newD, true)
					break
			}
			this.index++
			// console.log("redo")
			// console.log(`stack: ${this.stack}`)
			// console.log(`index: ${this.index}`)
		}
	}

let
	clickdown,
	currentLayer = 0,
	currentPath = paths[0]

/** handles parsed NaN without messing with falsy 0 */
function opacityCondition(attr, sign) {
	let f = parseFloat(currentPath.el.getAttribute(attr))
	if(f !== 0) f ||= 1
	if(sign === "<") return f < 1
	else return f > 0
}

function toggleGUI(id) {
	if(id === "all") {
		const fn = guiHidden.all ? "remove" : "add"
		for(const el of document.getElementById("gui").children) {
			el.classList[fn]("hide")
		}

		const flip = !guiHidden.all
		for(const key in guiHidden) {
			guiHidden[key] = flip
		}
		return
	}
	if(guiHidden[id]) document.getElementById(id).classList.remove("hide")
	else document.getElementById(id).classList.add("hide")

	guiHidden[id] = !guiHidden[id]
}

function drawArc(x, y, r) {
	ctx.moveTo(x, y)
	ctx.arc(x, y, r, 0, 2 * Math.PI)
}

function drawGrid(redraw) {
	if(render.preview) return
	if(drawCache.grid && !redraw) return ctx.drawImage(drawCache.grid, 0, 0)

	ctx.beginPath()
	const bigR = grid.gap * 4
	for(let x = grid.offsetX;x < canvas.width;x += grid.gap) {
		for(let y = grid.offsetY;y < canvas.height;y += grid.gap) {
			drawArc(x, y, x % bigR === grid.offsetX && y % bigR === grid.offsetY ? 2 : 1)
		}
	}
	ctx.fillStyle = "darkgrey"
	ctx.fill()

	canvas.toBlob(blob => {
		const src = URL.createObjectURL(blob)
		drawCache.grid = new Image()
		drawCache.grid.onload = _ => {
			URL.revokeObjectURL(src)
			draw()
		}
		drawCache.grid.src = src
	})
}

function drawRender(redraw) {
	if(drawCache.render) {
		ctx.drawImage(drawCache.render, grid.offsetX, grid.offsetY)
		if(!redraw) return
	}

	const src = URL.createObjectURL(new Blob(
		[new XMLSerializer().serializeToString(render.svg)],
		{type: "image/svg+xml"}
	))

	drawCache.render = new Image()
	drawCache.render.onload = _ => {
		URL.revokeObjectURL(src)
		draw()
	}
	drawCache.render.src = src
}

function drawPlacedPoints() {
	if(render.preview) return
	for(const segment of currentPath.d) {
		ctx.beginPath()
		for(const point of segment) {
			drawArc(point.x * grid.gap + grid.offsetX, point.y * grid.gap + grid.offsetY, grid.gap / 3)
		}
		ctx.fillStyle = "black"
		ctx.fill()

		ctx.beginPath()
		for(const point of segment) {
			drawArc(point.x * grid.gap + grid.offsetX, point.y * grid.gap + grid.offsetY, grid.gap / 6)
		}
		ctx.fillStyle = "white"
		ctx.fill()
	}
}

function drawPreviewPoints() {
	ctx.beginPath()
	for(const point of previewPoints) {
		drawArc(point[0] * grid.gap + grid.offsetX, point[1] * grid.gap + grid.offsetY, 3)
	}
	ctx.fillStyle = "grey"
	ctx.fill()
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

	if(!(clickdown?.points && clickdown.b === 0)) return

	ctx.beginPath()
	ctx.moveTo(0, y)
	ctx.lineTo(canvas.width, y)
	ctx.moveTo(x, 0)
	ctx.lineTo(x, canvas.height)
	ctx.moveTo(clickdown.x * grid.gap + grid.offsetX, clickdown.y * grid.gap + grid.offsetY)
	ctx.lineTo(x, y)
	ctx.strokeStyle = "grey"
	ctx.setLineDash([4, 2])
	ctx.lineWidth = 2
	ctx.stroke()
}

function draw({grid, render} = {}) {
	canvas.width = canvas.width
	drawGrid(grid)
	drawRender(render)
	drawPlacedPoints()
	drawPreviewPoints()
	drawCursor()
}

function togglePreview() {
	render.preview = !render.preview
	draw()
}

function stringifySegment(segment) {
	if(segment.length === 0) return ""

	let d = ""
	for(let i = 0;i < segment.length;i++) {
		let point = segment[i]
		switch(point.type) {
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

	const first = segment[0]
	const last = segment[segment.length - 1]
	if(first.x === last.x && first.y === last.y) d += "Z"

	return d
}

//TODO don't build after every action; just add new points as needed; goal: only call before exporting
//TODO proper layer addition and removal
function buildSVG() {
	render.svg.setAttribute("width", canvas.width - grid.offsetX * 2)
	render.svg.setAttribute("height", canvas.height - grid.offsetY * 2)
	render.svg.setAttribute("viewBox", `0 0 ${grid.x} ${grid.y}`) //MAYBE cache viewbox in var for other uses
	//TODO insert paths at correct index instead of clearing each build
	render.svg.innerHTML = ""

	for(const path of paths) {
		render.svg.appendChild(path.el)
		let d = ""
		for(const segment of path.d) {
			d += stringifySegment(segment)
		}
		path.el.setAttribute("d", d)
	}
}

/** assumes render.(svg|img) is built before reaching this method */
// currently only exports svg properly
function saveAs(type) {
	const s = new XMLSerializer().serializeToString(render.svg)
	const a = document.createElement("a")
	a.download = `pegboard-${new Date().getTime()}`
	a.href = URL.createObjectURL(new Blob([s], {type}))
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

/** @param {number} d */
function setCurrentPath(d) {
	const l = Math.min(Math.max(d, 0), paths.length)
	if(l === currentLayer) return

	currentLayer = l

	paths[currentLayer] ||= {el: document.createElementNS("http://www.w3.org/2000/svg", "path"), d: []}
	currentPath = paths[currentLayer]
	render.svg.appendChild(currentPath.el) //TODO insert at correct index

	for(const el of document.querySelectorAll("input, select")) {
		if(el.tagName === "SELECT") el.value = currentPath.el.getAttribute(el.id) || el.options[0].label
		else switch(el.dataset.target) {
			case "layer":
				el.value = currentLayer
				break
			case "percent":
				el.value = parseFloat(currentPath.el.getAttribute(el.id)) * 100 || el.defaultValue
				break
			case "rgb":
				el.value = currentPath.el.getAttribute(el.id)?.substring(1) || el.defaultValue
				break
			case "number":
			case "number-list":
				el.value = currentPath.el.getAttribute(el.id) || el.defaultValue
		}
	}

	draw()
}

function replacePath(path, d, fromTimeline = false) {
	if(!fromTimeline) timeline.track("replacePath", path, path.d, d)
	path.d = d

	let d_attr = ""
	for(const segment of d) {
		d_attr += stringifySegment(segment)
	}
	path.el.setAttribute("d", d_attr)
	draw({render: true})
}

/**
 * works directly with `previewPoints`
 * @param count - control points + end point for beziers
 */
function segmentifyPoints(type, count = 1) {
	const segment = [{x: previewPoints[0][0], y: previewPoints[0][1], type: "M"}]
	for(let i = 1;i < previewPoints.length;i++) {
		segment.push({x: previewPoints[i][0], y: previewPoints[i][1], type: `${type}${i % count}`})
	}

	previewPoints.length = 0
	return segment
}

function addSegment(path, segment, fromTimeline = false) {
	if(!fromTimeline) timeline.track("addSegment", path, segment)

	path.d.push(segment)
	path.el.setAttribute(
		"d",
		(path.el.getAttribute("d") || "") + stringifySegment(segment)
	)
	draw({render: true})
}

function rmSegment(path, segment, fromTimeline = false) {
	if(!fromTimeline) timeline.track("rmSegment", path, segment)

	path.d.pop()
	let d = ""
	for(const s of path.d) {
		d += stringifySegment(s)
	}
	path.el.setAttribute("d", d)
	draw({render: true})
}

/** assumes all points start at the same position */
function movePoints(points, newPos, fromTimeline = false) {
	if(!fromTimeline) timeline.track("movePoints", points, [points[0].x, points[0].y], newPos)

	for(const point of points) {
		point.x = newPos[0]
		point.y = newPos[1]
	}
	buildSVG()
	draw({render: true})
}

/**
 * from undo only
 * reattaches point to segment
 * point's segment & index should be referenced in the point object
 */
function reattachPoints(points) {
	for(let i = points.length - 1;i >= 0;i--) {
		const p = points[i]
		p.segment.splice(p.i, 0, p)
		switch(p.type) {
			case "Q1":
				p.segment[p.i + 1].type = "Q0"
				break
			case "Q0":
				p.segment[p.i - 1].type = "Q1"
				break
			case "C1":
				p.segment[p.i + 1].type = "C2"
				p.segment[p.i + 2].type = "C0"
				break
			case "C2":
				p.segment[p.i - 1].type = "C1"
				p.segment[p.i + 1].type = "C0"
				break
			case "C0":
				p.segment[p.i - 2].type = "C1"
				p.segment[p.i - 1].type = "C2"
				break
			default:
				if(p.type[0] !== "M") break
				if(p.type === "M") break
				// ex. change self type from "ML0" to "M" and next point type from "M" to "L0"
				p.segment[p.i + 1].type = p.type.slice(1)
				p.type = "M"

				switch(p.segment[p.i + 1].type) {
					case "Q1":
						p.segment[p.i + 2].type = "Q0"
						break
					case "C1":
						p.segment[p.i + 2].type = "C2"
						p.segment[p.i + 3].type = "C0"
				}
		}

		delete p.segment
		delete p.i
	}

	buildSVG() //TODO build only currentPath.d
	draw({render: true})
}

function rmPoints(path, points, fromTimeline = false) {
	if(!fromTimeline) timeline.track("rmPoints", path, points)

	for(const p of points) {
		for(const segment of path.d) {
			if(!segment.includes(p)) continue

			p.segment = segment
			p.i = segment.indexOf(p)
			switch(p.type) {
				case "M":
					if(!segment[1]) break
					if(segment[1].type === "Q1") segment[2].type = "A0"
					else if(segment[1].type === "C1") {
						segment[2].type = "Q1"
						segment[3].type = "Q0"
					}
					p.type += segment[1].type // ex. change type from "M" to "ML0"
					segment[1].type = "M"
					break
				case "Q1":
					segment[p.i + 1].type = "A0"
					break
				case "Q0":
					segment[p.i - 1].type = "A0"
					break
				case "C1":
					segment[p.i + 1].type = "Q1"
					segment[p.i + 2].type = "Q0"
					break
				case "C2":
					segment[p.i - 1].type = "Q1"
					segment[p.i + 1].type = "Q0"
					break
				case "C0":
					segment[p.i - 2].type = "Q1"
					segment[p.i - 1].type = "Q0"
			}
			segment.splice(p.i, 1)
			break
		}
	}

	buildSVG()
	draw({render: true})
}

function cycleAttrOpts(attr, opts) {
	const prev = currentPath.el.getAttribute(attr) || opts[0]
	const next = opts[(opts.indexOf(prev) + 1) % opts.length]

	if(next === opts[0]) currentPath.el.removeAttribute(attr)
	else currentPath.el.setAttribute(attr, next)

	document.getElementById(attr).value = next

	draw({render: true})
}

//TODO match with gui
function updateWidth(n) {
	const prev = parseInt(currentPath.el.getAttribute("stroke-width")) || 1
	const next = Math.max(prev + n, 1)

	if(next > 1) currentPath.el.setAttribute("stroke-width", next)
	else currentPath.el.removeAttribute("stroke-width")

	document.getElementById("stroke-width").value = next

	if(next !== prev) draw({render: true})
}

function updateOpacity(attr, n) {
	let prev = parseFloat(currentPath.el.getAttribute(attr)) * 100
	// js bruh moment: 0 is falsy
	if(prev !== 0) prev ||= 100
	const next = Math.min(Math.max(prev + n, 0), 100)

	if(next < 100) currentPath.el.setAttribute(attr, next / 100)
	else currentPath.el.removeAttribute(attr)

	document.getElementById(attr).value = next

	if(next !== prev) draw({render: true})
}

function setKeybindLayer(l) {
	for(const k of "qwertasdfgzxcvb") {
		const b = document.getElementById(k)
		if(keybinds[l][k]) {
			b.style.setProperty("--tooltip", `'${keybinds[l][k].text}'`)
			if(keybinds[l][k].condition()) b.disabled = false
			else b.disabled = true
		} else {
			b.style.removeProperty("--tooltip")
			b.disabled = true
		}
	}
}

function keydown(e) {
	if(document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT") {
		switch(e.key) {
			case "Enter":
			case "Escape":
				document.activeElement.blur()
				break
			case "Tab":
				e.preventDefault()
				const cyclegroup = [...document.querySelectorAll("input, select")]
				let next = (cyclegroup.indexOf(document.activeElement) + (e.shiftKey ? -1 : 1)) % cyclegroup.length
				if(next < 0) next = cyclegroup.length - 1
				cyclegroup[next].focus()
		}
		return
	}
	if(e.repeat) return
	switch(e.key) {
		case "Shift":
			if(e.gui) {
				if(shift.held) return

				if(shift.toggled) {
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
		case "Escape":
			previewPoints.length = 0
			draw()
			setKeybindLayer(shift.down ? 1 : 0)
			break
		case "Tab":
			e.preventDefault()
			document.querySelector("input, select").focus()
			break
		default:
			const k = keybinds[shift.down ? 1 : 0][e.key.toLowerCase()]
			if(k?.condition()) {
				k.command()
				setKeybindLayer(shift.down ? 1 : 0)
			}
	}
}

function keyup(e) {
	if(e.key !== "Shift") return
	if(e.target?.tagName === "INPUT") return
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
	draw({grid: true})
}

function wheel(e) {
	grid.gap += e.deltaY < 0 ? 1 : -1
	grid.x = Math.trunc(canvas.width / grid.gap)
	grid.y = Math.trunc(canvas.height / grid.gap)
	grid.offsetX = Math.trunc(canvas.width % grid.gap / 2)
	grid.offsetY = Math.trunc(canvas.height % grid.gap / 2)
	buildSVG()
	draw({grid: true, render: true})
}

function mousemove(e) {
	const x = Math.trunc((e.clientX + grid.gap / 2 - grid.offsetX) / grid.gap)
	const y = Math.trunc((e.clientY + grid.gap / 2 - grid.offsetY) / grid.gap)

	if(cursor.x !== x || cursor.y !== y) {
		document.getElementById("cursor").textContent = `x: ${x}, y: ${y}`
		cursor.x = x
		cursor.y = y
		draw()
	}
}

function mousedown(e) {
	if(clickdown) return
	clickdown = {x: cursor.x, y: cursor.y, b: e.button}

	for(const segment of currentPath.d) {
		for(const point of segment) {
			if(point.x === cursor.x && point.y === cursor.y) {
				clickdown.points ||= []
				clickdown.points.push(point)
			}
		}
	}
}

function mouseup(e) {
	if(!clickdown) return
	if(clickdown.b !== e.button) return

	switch(e.button) {
		case 0:
			// add preview point
			if(cursor.x === clickdown.x && cursor.y === clickdown.y || !clickdown.points) {
				previewPoints.push([cursor.x, cursor.y])
				ctx.beginPath()
				drawArc(cursor.x * grid.gap + grid.offsetX, cursor.y * grid.gap + grid.offsetY, 3)
				ctx.fillStyle = "grey"
				ctx.fill()
				// toggle draw buttons when preview point gets added
				setKeybindLayer(shift.down ? 1 : 0)
			} else movePoints(clickdown.points, [cursor.x, cursor.y])
			break
		case 2: if(clickdown.points) rmPoints(currentPath, clickdown.points)
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

for(const el of document.querySelectorAll("input, select")) {
	if(el.tagName === "SELECT") el.addEventListener("change", _ => {
		if(el.selectedOptions[0].defaultSelected) currentPath.el.removeAttribute(el.id)
		else currentPath.el.setAttribute(el.id, el.value)

		draw({render: true})
	})
	else switch(el.dataset.target) {
		case "layer":
			el.addEventListener("change", _ => el.checkValidity() && setCurrentPath(parseInt(el.value)))
			break
		case "percent":
			el.addEventListener("input", _ => {
				if(!el.checkValidity()) return
				if(el.value === el.defaultValue) currentPath.el.removeAttribute(el.id)
				else currentPath.el.setAttribute(el.id, parseInt(el.value) / 100)
				draw({render: true})
			})
			break
		case "rgb":
			el.addEventListener("input", _ => {
				if(!el.checkValidity()) return
				if(el.value === el.defaultValue) currentPath.el.removeAttribute(el.id)
				else currentPath.el.setAttribute(el.id, "#" + el.value)
				draw({render: true})
			})
			break
		case "number":
			el.addEventListener("input", _ => {
				if(!el.checkValidity()) return
				if(el.value === el.defaultValue) currentPath.el.removeAttribute(el.id)
				else currentPath.el.setAttribute(el.id, parseInt(el.value))
				draw({render: true})
			})
			break
		case "number-list":
			el.addEventListener("input", _ => {
				if(!el.checkValidity()) return
				if(el.value === el.defaultValue) currentPath.el.removeAttribute(el.id)
				else currentPath.el.setAttribute(el.id, el.value.trim().replaceAll(/\s+/g, " "))
				draw({render: true})
			})
	}
}

render.svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
render.svg.setAttribute("stroke", "#000") //MAYBE delete or handle default path values better
render.svg.setAttribute("fill", "none")

setKeybindLayer(0)
resize()
