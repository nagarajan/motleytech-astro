---
title: "Bezier curve playground"
pubDate: 2015-04-16
category: "Blog"
tags: ["Javascript", "CSS", "Bezier curves"]
author: "Nagarajan"
description: "Bezier curves are one of the *cooler* things with built-in support in the web browser - which makes it easier to create this demo in the browser (vs a custom native UI).<br /> <div style=\"display: flex; justify-content: center\"><img style=\"width: 400px; border: 2px solid gray; padding: 15px; box-sizing: border-box\" src=\"/images/Bezier curve screenshot.webp\" /></div>"
legacySlug: "bezier-curve"
disqusIdentifier: "bezierPlayground"
---
Bezier curves are one of the *cooler* things with built-in support in the web browser - which makes it easier to create this demo in the browser (vs a custom native UI). Below is a playground to tinker with cubic bezier curves.

You can

* add new points - click on a empty area
* move the existing points (blue dots) - click and drag
* move the control points (the points with circles) - again, click and drag

Have a go... try adding a couple of points and dragging the resulting control points.

<div class='bezierContainer'>
    <div class="playground">
        <svg class='thecurve'>
            <path stroke-width="2px" stroke='#555' fill='transparent'></path>
        </svg>
        <svg class='thepoints'>
        </svg>
        <svg class='cpoints1'>
        </svg>
        <svg class='cpoints2'>
        </svg>
        <svg class='clines1'>
        </svg>
        <svg class='clines2'>
        </svg>
    </div>
</div>
<div class="svgcode">
    <p>SVG Path for the curve</p>
    <div class="svgcodeText">
        <textarea onInput="this.parentNode.dataset.replicatedValue = this.value"></textarea>
    </div>
</div>

If you are wondering how they work, there are a huge number of [articles](https://en.wikipedia.org/wiki/B%C3%A9zier_curve), explanations and animations of bezier curves on the internet (this article adds one more to the demos) - and [this section on the wikipedia article](https://en.wikipedia.org/wiki/B%C3%A9zier_curve#Higher-order_curves) does a great job of explaining cubic+ bezier curves using animations. I refreshed my knowledge on the topic from that very article.

<link rel="stylesheet" href="/css/bezier/app.css">
<script src='/js/bezier/bezier.js'></script>
