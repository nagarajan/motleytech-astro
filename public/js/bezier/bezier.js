(function () {
    let playground = document.querySelector('.playground')
    let svgcode = document.querySelector('.svgcode')

    const CLICK_RADIUS_CIRCLE = 9
    const CLICK_RADIUS_POINT = 4

    function * pairwise (iterable) {
        const iterator = iterable[Symbol.iterator]()
        let current = iterator.next()
        let next = iterator.next()
        while (!next.done) {
            yield [current.value, next.value]
            current = next
            next = iterator.next()
        }
    }

    function positionDiff (p1, p2) {
        return Math.max(Math.abs(p1.x - p2.x), Math.abs(p1.y - p2.y))
    }

    function getPosition (e) {
        return {x: e.layerX, y: e.layerY}
    }

    function createPoint (pos) {
        return {pos: pos, cp1: null, cp2: null}
    }

    function addPoint (p, points) {
        if (points.length > 0) {
            const p0 = points[points.length -1]
            const [c1, c2] = getControlPoints(p0, p)
            p0.cp2 = c1
            p.cp1 = c2
        }
        points.push(p)
        updateView()
    }

    function updateView () {
        plotPoints()
        plotLines()
        updateCurve()
        updateOutput()
    }

    function updateOutput () {
        const el = document.querySelector('.svgcodeText textarea')
        const path = document.querySelector('.thecurve path')
        el.value = path.getAttribute('d')
        el.parentNode.dataset.replicatedValue = el.value;
    }

    function plotLines () {
        populateLines(points, document.querySelector('.clines1'), 'cp1')
        populateLines(points, document.querySelector('.clines2'), 'cp2')
    }

    function populateLines (points, cont, attr) {
        points.forEach((p, index) => {
            let line
            if (cont.children.length <= index) {
                line = document.createElementNS("http://www.w3.org/2000/svg", "line")
                cont.appendChild(line)
            } else {
                line = cont.children[index]
            }
            if (p[attr] !== null) {
                line.setAttribute('display', null)
                line.setAttribute('x1', p.pos.x)
                line.setAttribute('y1', p.pos.y)
                line.setAttribute('x2', p[attr].x)
                line.setAttribute('y2', p[attr].y)
                line.setAttribute('stroke', 'gray')
                line.setAttribute('stroke-width', '1')
                line.setAttribute('stroke-dasharray', '4')
            } else {
                line.setAttribute('display', 'none')
            }
        })

        if (cont.children.length > points.length) {
            const clen = cont.children.length
            for (let x = clen-1; x >= points.length; x--) {
                const child = cont.children[x]
                cont.removeChild(child)
            }
        }
    }

    function plotPoints () {
        const pointsContainer = document.querySelector('.thepoints')
        populatePointsData(points, pointsContainer, 'pos', { r:CLICK_RADIUS_POINT, stroke: '#0087ff', fill: '#0087ff' })
        const cp1Container = document.querySelector('.cpoints1')
        populatePointsData(points, cp1Container, 'cp1', { stroke: '#181' })
        const cp2Container = document.querySelector('.cpoints2')
        populatePointsData(points, cp2Container, 'cp2', { stroke: '#d22' })
    }

    function populatePointsData (points, cont, cattr, attrs) {
        const {
            r = CLICK_RADIUS_CIRCLE,
            width = '1',
            stroke = 'blue',
            fill = 'transparent'
        } = attrs
        points.forEach((p, index) => {
            let circle
            if (cont.children.length <= index) {
                circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
                cont.appendChild(circle)
            } else {
                circle = cont.children[index]
            }
            if (p[cattr] !== null) {
                circle.setAttribute('display', null)
                circle.setAttribute('cx', p[cattr].x)
                circle.setAttribute('cy', p[cattr].y)
                circle.setAttribute('r', r)
                circle.setAttribute('stroke-width', width)
                circle.setAttribute('stroke', stroke)
                circle.setAttribute('fill', fill)
            } else {
                circle.setAttribute('display', 'none')
            }
        })

        if (cont.children.length > points.length) {
            const clen = cont.children.length
            for (let x = clen-1; x >= points.length; x--) {
                const child = cont.children[x]
                cont.removeChild(child)
            }
        }
    }



    function mag(v) {
        return Math.sqrt(v.x**2 + v.y**2)
    }

    function dvec(d1, d2) {
        return {x: d2.x - d1.x, y: d2.y - d1.y}
    }

    function udir(d1, d2) {
        const v = dvec(d1, d2)
        const vmag = mag(v)
        return {x: v.x/vmag, y: v.y/vmag}
    }

    function opp(v) {
        return {x: -v.x, y: -v.y}
    }

    function scale(v, s) {
        return {x: v.x*s, y: v.y*s}
    }

    function vsum(u, v) {
        return {x: u.x + v.x, y: u.y + v.y}
    }

    function _2f0(fp) {
        return fp.toFixed(0)
    }

    function getControlPoints (p1, p2) {
        const dp1p2 = dvec(p1.pos, p2.pos)
        const mp1p2 = mag(dp1p2)

        let dp1c2
        if (p1.cp1 === null) {
            dp1c2 = scale(udir(p1.pos, p2.pos), mp1p2*0.6)
        } else {
            dp1c2 = scale(opp(udir(p1.pos, p1.cp1)), mp1p2*0.6)
        }
        const p1cp2 = vsum(p1.pos, dp1c2)

        const p2cp1 = vsum(scale(udir(p2.pos, p1cp2), mp1p2/2), p2.pos)
        return [p1cp2, p2cp1]

    }

    function updateCurve () {
        if (points.length > 1) {
            const path = document.querySelector('.thecurve path')

            let thePath = `M ${points[0].pos.x} ${points[0].pos.y}`

            for (const [p1, p2] of pairwise(points)) {
                const [c1, c2] = [p1.cp2, p2.cp1]
                thePath += ` C ${_2f0(c1.x)} ${_2f0(c1.y)}, ${_2f0(c2.x)} ${_2f0(c2.y)}, ${_2f0(p2.pos.x)} ${_2f0(p2.pos.y)}`
            }
            path.setAttribute('d', thePath)
        }
    }

    function getObjectUnder (pos) {
        for (let i = 0; i < points.length; i++) {
            const p = points[i]
            if (positionDiff(p.pos, pos) <= CLICK_RADIUS_POINT) {
                return {index: i, point: p, attr: 'pos'}
            }
            if (p.cp1 && (positionDiff(p.cp1, pos) <= CLICK_RADIUS_CIRCLE)) {
                return {index: i, point: p, attr: 'cp1'}
            }
            if (p.cp2 && (positionDiff(p.cp2, pos) <= CLICK_RADIUS_CIRCLE)) {
                return {index: i, point: p, attr: 'cp2'}
            }
        }
        return null
    }

    function dragObject (obj, cpos, mdpos, dragEnd=false) {
        if (obj.attr === 'pos') {
            // move all 3 points
            const vdiff = dvec(mdpos, cpos)
            obj.point.pos = vsum(obj.preDrag.pos, vdiff)
            if (obj.point.cp1) {
                obj.point.cp1 = vsum(obj.preDrag.cp1, vdiff)
            }
            if (obj.point.cp2) {
                obj.point.cp2 = vsum(obj.preDrag.cp2, vdiff)
            }
        } else if (obj.attr === 'cp1') {
            const vdiff = dvec(mdpos, cpos)
            obj.point.cp1 = vsum(obj.preDrag.cp1, vdiff)
            if (obj.point.cp2) {
                const upcp2 = opp(udir(obj.point.pos, obj.point.cp1))
                const mpcp2 = mag(dvec(obj.point.pos, obj.point.cp2))
                obj.point.cp2 = vsum(obj.point.pos, scale(upcp2, mpcp2))
            }
        } else if (obj.attr === 'cp2') {
            const vdiff = dvec(mdpos, cpos)
            obj.point.cp2 = vsum(obj.preDrag.cp2, vdiff)
            if (obj.point.cp1) {
                const upcp1 = opp(udir(obj.point.pos, obj.point.cp2))
                const mpcp1 = mag(dvec(obj.point.pos, obj.point.cp1))
                obj.point.cp1 = vsum(obj.point.pos, scale(upcp1, mpcp1))
            }
        }
        updateView()
    }

    let points = JSON.parse('[{"pos":{"x":150,"y":200},"cp1":null,"cp2":{"x":300,"y":50}},{"pos":{"x":455,"y":200},"cp1":{"x":300,"y":350},"cp2":null}]')
    let objectUnderMouse = null

    let mouseDown = false
    let dragging = false
    let draggedObject = null

    playground.addEventListener('mousedown', (e) => {
        if (e.button !== 0) {
            // ignore everything except first mouse button
            return
        }
        mouseDown = true
        dragging = false
        draggedObject = null

        mouseDownPos = getPosition(e)
        objectUnderMouse = getObjectUnder(mouseDownPos)
    });

    playground.addEventListener('dblclick', (e) => {
        const pos = getPosition(e)
        const obj = getObjectUnder(pos)
        if (obj.attr === 'pos') {
            points.splice(obj.index, 1)
            points[0].cp1 = null
            points[points.length - 1].cp2 = null
            updateView()
        }
    });

    playground.addEventListener('mousemove', (e) => {
        let mousePos = getPosition(e)
        if (dragging) {
            if (draggedObject) {
                dragObject(draggedObject, mousePos, mouseDownPos)
            }
        } else if (mouseDown) {
            if (positionDiff(mousePos, mouseDownPos) > 5) {
                dragging = true
                draggedObject = objectUnderMouse
                draggedObject.preDrag = JSON.parse(JSON.stringify(draggedObject.point))
            }
        }
    });

    playground.addEventListener('mouseup', (e) => {
        if (e.button !== 0) {
            // ignore everything except first mouse button
            return
        }
        mouseDown = false
        mouseUpPos = getPosition(e)
        if (!dragging && !objectUnderMouse) {
            addPoint(createPoint(mouseUpPos), points)
        }
        dragging = false
        draggedObject = null
    });

    updateView()
})()
