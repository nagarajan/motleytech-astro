---
title: "Magic Squares"
pubDate: 2015-05-29
category: "Blog"
tags: ["Magic Square", "Computing", "Mathematics"]
author: "Nagarajan"
description: "A conventional magic square of order n is a square filled with the numbers 1 through n\\*n such that the sum of each row, column or diagonal is the same.<br /> <div style=\"display: flex; justify-content: center\"><img style=\"width: 400px; border: 2px solid gray; box-sizing: border-box\" src=\"/images/Magic square screenshot.webp\" /></div><br /> Each number in the square must be distinct, and thus every number from 1 to n*n is used exactly once. The sum of the row in the 5x5 square above is 65."
legacySlug: "magicSquare"
disqusIdentifier: "magic_squares"
---
A conventional [magic square](http://en.wikipedia.org/wiki/Magic_square) of order n is a square filled with the numbers 1 through n\*n such that the sum of the rows, columns and diagonals is the same. Each number in the square must be distinct, and thus every number is used exactly once.

Surprisingly, it is very easy to create magic squares when n is odd. Magic squares of even n also exist, but creating them is comparatively more difficult.

What follows is a program to create odd magic squares of any (reasonable) size. Give it a try... enter an odd number (3 to 49) and the program should reply with a magic square.

<script src="/js/magicSquare.js"></script>

<input id="sqsize" type="number" min="3" max="49" step="2" class="form-control" value="3" />
<button id="btngenerate" onclick="magicSquare.onGenerate()" class="btn btn-info" type="button">Generate!</button>
<span id="errorspan" class="label label-danger"></span>

**Animation speed**: <input id="aspeed" type="range" min="0" max="10" step="1" value="5" oninput="magicSquare.updateAnimSpeed()" style="width: 300px"/> <span id="viewspeed">1.0x</span><br />
**Show arrows**: <input id="ashow" type="checkbox" onchange="magicSquare.updateAnimShow()"/>


<hr />

<div id="magicsquare"></div>

<hr />

## Algorithm

The program uses an extraordinarily simple algorithm (which you might be able to understand in its entirety just by looking at the animation above). It is called the [Siamese Method](https://en.wikipedia.org/wiki/Siamese_method).

1. We start at top row, middle column and write "1" in that cell.
2. We move diagonally from the current cell towards top right direction. There are 5 possibilities for this movement.

    a. We reach an empty cell. In this case, we write the next number in the empty cell and it becomes our new current cell. Repeat step 2.

    b. We reach an occupied cell. In this case, we move to the cell directly below the current cell (which will be empty). We write the next number into this cell, and it becomes the current cell. Repeat step 2.

    c. We fall out of the square at the top (not the corner). In this case, we move to the cell on the last row on the next column and write the next number. Repeat step 2.

    d. We fall out of the square at the right (not the corner). We move to the first column of the row above and write the next number. Repeat step 2.

    e. We fall out at the top right corner. In this case, we move to the cell below the current cell and write the next number. Repeat step 2.

3. Done. :-).

An even easier way to understand the algorithm is to imagine repeating copies of our square in both the x and y directions. In that case, the rules become even simpler.

1. Start at middle of top row and write 1 (all copies of the square also get a 1 in the same place).
2. Move to the cell towards the top right. If top-right cell is occupied, move one cell down instead. Write the next number (in the same cell in all copies) and repeat this step.

Much easier than remembering 5 different steps.


<div style="position: fixed">
  <img class="arrows" id="greenarrowtopright" src="images/right-arrow-green.svg"
      style="transform: rotate(-45deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="greenarrowleft" src="images/right-arrow-green.svg"
      style="transform: rotate(180deg); display: none"
   />
</div>
<div style="position: fixed">
  <img class="arrows" id="greenarrowdown" src="images/right-arrow-green.svg"
      style="transform: rotate(90deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="redarrowleft" src="images/right-arrow-red.svg"
      style="transform: rotate(180deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="redarrowdown" src="images/right-arrow-red.svg"
      style="transform: rotate(90deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="redarrowtopright" src="images/right-arrow-red.svg"
      style="transform: rotate(-45deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="orangearrowtopright" src="images/right-arrow-orange.svg"
      style="transform: rotate(-45deg); display: none"
  />
</div>
<script>
  window.onload = function () { magicSquare.initialize() }
</script>
<noscript style="color:red">
  You must have javascript enabled in order to use this application.
</noscript>
