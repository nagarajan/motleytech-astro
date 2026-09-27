---
title: "Magic Squares"
pubDate: 2015-05-29
category: "Blog"
tags: ["Magic Square", "Computing", "Mathematics"]
author: "Nagarajan"
description: "How to construct magic squares of any order, where every row, column and diagonal share a sum."
trailer: "In a magic square of order n, every row, column and diagonal add up to the same number while using each of 1 through n squared exactly once. Here is how to build them, and why the odd, even and doubly even cases each need a trick of their own."
heroImage: "/images/demos/magic-square.webp"
heroAlt: "A five by five magic square where every row, column and diagonal sums to 65"
legacySlug: "magicSquare"
disqusIdentifier: "magic_squares"
---
A conventional [magic square](http://en.wikipedia.org/wiki/Magic_square) of order n is a square filled with the numbers 1 through n\*n such that the sum of the rows, columns and diagonals is the same. Each number in the square must be distinct, and thus every number is used exactly once.

Surprisingly, it is very easy to create magic squares when n is odd. Magic squares of even n also exist, but they need entirely different constructions - and the even sizes split into two cases which need one method each.

What follows is a program to create magic squares of any (reasonable) size. Give it a try... enter a number from 3 to 49 and the program should reply with a magic square. (There is no magic square of order 2, and order 1 is a bit of a let-down.)

<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="/js/magicSquare.js"></script>

<input id="sqsize" type="number" min="3" max="49" step="1" class="form-control" value="3" />
<button id="btngenerate" onclick="magicSquare.onGenerate()" class="btn btn-info" type="button">Generate!</button>
<span id="errorspan" class="label label-danger"></span>

**Animation speed**: <input id="aspeed" type="range" min="0" max="10" step="1" value="5" oninput="magicSquare.updateAnimSpeed()" style="width: 300px"/> <span id="viewspeed">1.0x</span><br />
**Show arrows**: <input id="ashow" type="checkbox" onchange="magicSquare.updateAnimShow()"/>


<hr />

<div id="magicsquare"></div>

<hr />

## Algorithm

There is no single recipe that covers every size. The program picks one of three, depending on n: the Siamese method for odd n, a sequence-and-flip trick when n is divisible by 4, and the LUX method for the even sizes left over (6, 10, 14, ...). Only the odd method is a walk across the square, so the arrows in the animation above appear for odd sizes only.

### Odd n - the Siamese method

For odd n the program uses an extraordinarily simple algorithm (which you might be able to understand in its entirety just by looking at the animation above). It is called the [Siamese Method](https://en.wikipedia.org/wiki/Siamese_method).

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

### n divisible by 4

This case is the easiest of the three, and it barely looks like an algorithm at all.

1. Write the numbers 1 to n\*n into the square in plain reading order - left to right, top to bottom. Obviously this is not magic yet: the rows are far too lopsided.
2. Now cut the square into 4x4 blocks, and look at the two diagonals of each block. Every cell on one of those diagonals gets replaced by its complement: a cell holding **v** becomes **n\*n + 1 - v**.

That is the whole method. In code, the test for "is this cell on a diagonal of its block" is just `r % 4 === c % 4` for one diagonal and `(r % 4) + (c % 4) === 3` for the other.

For n = 4 this produces the square below, which is the same one [Albrecht Dürer](https://en.wikipedia.org/wiki/Melencolia_I) hid in the corner of *Melencolia I* in 1514, give or take a reflection.

<div class="noteworthy-equation">
<pre>16  2  3 13
 5 11 10  8
 9  7  6 12
 4 14 15  1</pre>
</div>

Why it works is worth a moment. Reading order makes each row an arithmetic run, so a row is wrong by a fixed amount. Complementing exactly two cells per row per block cancels that error precisely, and because the chosen cells are the block diagonals, the same cancellation lands on the columns and on both long diagonals too.

### The remaining even n - the LUX method

The sizes that are even but not divisible by 4 (6, 10, 14, ...) are the awkward ones, and they get the nicest trick: [Conway's LUX method](https://en.wikipedia.org/wiki/Conway%27s_LUX_method_for_magic_squares), which builds the answer on top of the odd method we already have.

Write n as 4m+2. The square is then a grid of 2x2 blocks, (2m+1) blocks across, and we label each block **L**, **U** or **X**. Each letter is a way of arranging four consecutive numbers inside its 2x2 block:

<div class="noteworthy-equation">
<pre>   L        U        X
 4  1     1  4     1  4
 2  3     2  3     3  2</pre>
</div>

The labels are laid out in rows: the first m+1 rows of blocks are all **L**, the next row is all **U**, and the rest are **X**. Then comes the one fiddly step - the **L** in the middle of the last L row swaps places with the **U** directly beneath it.

Finally, build an odd magic square of order 2m+1 using the Siamese method above, and read it as instructions for the blocks: wherever that odd square holds **k**, the corresponding block is filled with the four numbers 4k-3, 4k-2, 4k-1 and 4k, arranged according to its letter. The animation fills the square four cells at a time for exactly this reason - each 2x2 block is one step of the odd square underneath it.


<div style="position: fixed">
  <img class="arrows" id="greenarrowtopright" src="/images/right-arrow-green.svg"
      style="transform: rotate(-45deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="greenarrowleft" src="/images/right-arrow-green.svg"
      style="transform: rotate(180deg); display: none"
   />
</div>
<div style="position: fixed">
  <img class="arrows" id="greenarrowdown" src="/images/right-arrow-green.svg"
      style="transform: rotate(90deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="redarrowleft" src="/images/right-arrow-red.svg"
      style="transform: rotate(180deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="redarrowdown" src="/images/right-arrow-red.svg"
      style="transform: rotate(90deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="redarrowtopright" src="/images/right-arrow-red.svg"
      style="transform: rotate(-45deg); display: none"
  />
</div>
<div style="position: fixed">
  <img class="arrows" id="orangearrowtopright" src="/images/right-arrow-orange.svg"
      style="transform: rotate(-45deg); display: none"
  />
</div>
<script>
  window.onload = function () { magicSquare.initialize() }
</script>
<noscript style="color:red">
  You must have javascript enabled in order to use this application.
</noscript>
