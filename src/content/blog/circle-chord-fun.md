---
title: "Fun with circle chords"
pubDate: 2014-03-22
category: "Blog"
tags: ["Circle", "Chords"]
author: "Nagarajan"
description: "A fun little program to discover shapes conjured up drawing periodic chords in a circle. I made this for my kids to enjoy. <br /> <div style=\"display: flex; justify-content: center\"><img style=\"width: 600px; border: 2px solid gray; padding: 12px; box-sizing: border-box\" src=\"/images/circle chord screenshot.webp\" /></div> <br />"
legacySlug: "circle-chord-fun"
disqusIdentifier: "circle_chord_fun"
---
A fun little program to discover shapes conjured up drawing periodic chords in a circle. I made this for my kids to enjoy.

<style>
    #DemoCanvas {
        border: 1px solid #ddd;
    }
</style>
<body>
<canvas id="DemoCanvas" style="width: 100%"></canvas>
<br />

<div style="text-align: start">Number of points : </div>
<input type="range" min="1" max="2000" value="200" class="slider" id="numPointsSlider" style="width:100%">
<div id="numPointsDisplay" style="text-align: end"></div>

<div style="text-align: start">Jump Size : </div>
<input type="range" min="1" max="5000" value="40" class="slider" id="kJumpSlider" style="width:100%">
<div id="jumpSizeDisplay" style="text-align: end"></div>

<script>

    let width = 800
    let height = 600
    let nCirPts = 100
    let kJump = 4


    const wb2 = width / 2
    const hb2 = height / 2
    const cRadius = 0.8 * hb2

    let canvas = document.getElementById('DemoCanvas');
    let numPointsSlider = document.getElementById('numPointsSlider');
    let kJumpSlider = document.getElementById('kJumpSlider');
    let numPointsDisplay = document.getElementById('numPointsDisplay')
    let jumpSizeDisplay = document.getElementById('jumpSizeDisplay')

    canvas.setAttribute('width', width)
    canvas.setAttribute('height', height)

    numPointsSlider.oninput = function () {
        nCirPts = parseInt(this.value)
        const context = canvas.getContext('2d')
        context.clearRect(0, 0, canvas.width, canvas.height)
        numPointsDisplay.innerHTML = this.value

        drawFig(nCirPts, cRadius, kJump, canvas)
    }

    kJumpSlider.oninput = function () {
        kJump = parseFloat(this.value)/10.0
        const context = canvas.getContext('2d')
        context.clearRect(0, 0, canvas.width, canvas.height)
        jumpSizeDisplay.innerHTML = kJump.toString()

        drawFig(nCirPts, cRadius, kJump, canvas)
    }



    //Always check for properties and methods, to make sure your code doesn't break in other browsers.
    function line(x1, y1, x2, y2, canvas) {
        if (canvas.getContext) {
            var context = canvas.getContext('2d');
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.stroke();
        }
    }

    function offsetLine(p1, p2, canvas) {
        let  [x1, y1] = p1
        let [x2, y2] = p2
        x1 = wb2 + x1
        x2 = wb2 + x2
        y1 = hb2 - y1
        y2 = hb2 - y2
        line(x1, y1, x2, y2, canvas)
    }


    function getCircPts(nps, radius) {
        const scale = 2*Math.PI/nps
        const points = [];
        [...Array(nps).keys()].forEach(x => {
            const xs = x*scale
            const px = Math.cos(xs) * radius
            const py = Math.sin(xs) * radius
            points.push([px, py])
        })
        return points
    }


    function drawFig(nps, radius, jump, canvas) {
        const cPtsLocs = getCircPts(nps, radius);
        [...Array(nps).keys()].forEach( x => {
            const l1 = x + 1
            const l2 = Math.round(l1*jump)
            const p1 = cPtsLocs[l1 - 1]
            const p2 = cPtsLocs[(l2 - 1) % nps]
            offsetLine(p1, p2, canvas)
        })
    }

    function sleep(milliseconds) {
        var start = new Date().getTime();
        for (var i = 0; i < 1e7; i++) {
            if ((new Date().getTime() - start) > milliseconds) {
            break;
            }
        }
    }

    drawFig(nCirPts, cRadius, kJump, canvas)
    numPointsDisplay.innerHTML = nCirPts.toString()
    jumpSizeDisplay.innerHTML = kJump.toString()

</script>
</body>
