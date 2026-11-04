---
title: "Fold and snip"
pubDate: 2026-11-03
category: "Blog"
tags: ["Geometry", "Symmetry", "Mathematics", "Javascript", "Paper folding"]
author: "Nagarajan"
description: "A paper folding playground for kids: fold a square along any line, cut it with straight snips, and unfold it one fold at a time to see what you made."
trailer: "Fold a square of paper four times, make three straight snips, and unfold a six-pointed star. Every fold is a mirror, so every snip gets copied once for each layer, and a kid can watch exactly how that happens one unfold at a time."
heroImage: "/images/demos/fold-and-snip.webp"
heroAlt: "A square folded into a thin twelve-layer wedge, the wedge after three straight snips, and the six-pointed star it unfolds into"
disqusIdentifier: "foldAndSnip"
---

Every kid who has been handed safety scissors has done this: fold a piece of paper a few times, cut a notch out of the edge, and unfold it to find a snowflake. The surprise is the whole fun, and it is also a small piece of mathematics, because the shape you get is decided entirely by the folds and the cuts.

**Fold and Snip** is that game on a screen, built for my kid. You can fold a square along any line, cut it with a straight snip, and unfold it again one fold at a time, so you can see each cut being copied.

<p><a class="btn" href="/apps/fold-and-snip/" style="text-decoration: none; display: inline-block;">Open Fold and Snip &rarr;</a></p>

It works with a mouse or a finger, and it is happiest on a laptop or tablet screen.

## How to play

**Folding.** The dashed blue line is where the fold will happen. Drag around the paper to turn it, or type an angle, or use the buttons for flat, upright and the two diagonals. **Snap** mode jumps the angle in steps of 90°, 45°, 30°, 22.5° or 15°; **Free** mode allows any angle at all. The line goes through the ⊕ dot, which starts in the middle of the paper. Drag it, or type its position, to fold somewhere else. Tap the side of the paper you want to fold over: it turns blue, and an arrow shows where it will land. The flap can go over the top or tuck behind.

**Snipping.** Switch to the scissors and drag a straight line across the paper. The part that will fall off is shaded red; tap the other side if you want to keep that part instead. Press **Snip!** and the scissors go through every layer at once.

**Unfolding.** **Unfold one** opens the most recent fold, and **Unfold all** opens them all in turn. You can also fold again after unfolding some of the way. **Undo** takes back anything.

A **sneak peek** box shows what the paper would look like fully unfolded right now, for when you just cannot wait.

## Try this: a six-pointed star

Use Snap mode with 30° steps.

1. Fold at **0°**, top half down.
2. Fold at **120°**, bringing the bottom-right third across.
3. Fold at **60°**, bringing the bottom-left third across. The paper is now a 60° wedge, six layers thick.
4. Fold at **90°**, left side over, in half again. That leaves a thin 30° wedge, **twelve** layers thick, with its point at the middle of where the square used to be.

Now three snips:

1. Cut straight across the wide end of the wedge, at right angles to it, just short of where the ragged edges of the layers begin.
2. Cut a slanted line from the bottom of the wedge's straight left edge to about halfway down its right edge. Tap the bottom-right corner so that it is the red part that falls off.
3. Snip the very tip off the point.

Unfold all, and you get the star in the picture at the top, with a little star-shaped window in the middle.

## Why it works: every fold is a mirror

Folding paper along a line is a reflection. The half that moves lands exactly where the mirror image of that half would be. Folding again reflects everything again, layers and all. After the four folds above there are twelve layers in a 30° wedge, and each layer is a copy of a different 30° slice of the original square: six of them as they were, and six mirrored.

**A snip cuts all twelve layers at once**, so when you unfold, the one cut you made turns up twelve times. It turns up six times rotated around the centre and six more times reflected. That is exactly the symmetry of a snowflake: six-fold rotation, plus a mirror line through every arm. You don't have to make the shape symmetric. The folds take care of that.

There is one catch. A square doesn't have six-fold symmetry, so the twelve slices of a square aren't all the same shape: some of them include a corner and some do not. That is what the first snip across the wide end is for. It throws away everything outside a circle that fits inside the square, so what is left in each layer matches every other layer, and the outline comes out as a regular twelve-sided shape. If you skip it, any shape that keeps the outer part of the wedge gets bits of the square's corners poking out unevenly.

Which piece falls off also matters. Here are the same four folds and the same two snip lines (the wide end, then the slanted line), differing only in which side of the slanted line was thrown away:

![Left: a six-pointed star. Right: a twelve-sided shape with a six-pointed star-shaped hole in the middle](/images/fold-and-snip/star-and-window.webp)

The two shapes fit together exactly: put the star into the window and you get the twelve-sided outline back.

## One straight cut

There is a remarkable theorem hiding behind this. Erik Demaine, Martin Demaine and Anna Lubiw proved the **fold-and-cut theorem**: any shape with straight sides, a star, a swan, the outline of your initials, can be cut out of a single sheet of paper by folding it flat and making **one** complete straight cut. Harry Houdini described a one-cut five-pointed star in his 1922 book *Paper Magic*, and there is an old story that Betsy Ross won George Washington over to five-pointed stars on the flag by folding a sheet and producing one with a single snip.

Fold and Snip is more generous than the theorem, since you can snip as often as you like. But it is a good place to try the one-cut challenge. The star above took three snips. Can you get the plain six-pointed star, with no window, using just one? (A hint: look at which parts of the star the first snip actually removed.)

## Under the hood

The whole app is one HTML file with no libraries. The paper is kept as a list of flat pieces. Each piece knows three things:

- its outline, written down in the coordinates of the original square;
- the chain of reflections that carries it to where it currently lies in the folded stack;
- which layer of the stack it is in.

A **fold** splits every piece along the fold line, then reflects the pieces on the moving side and stacks them on top in reverse order, the way a turned-over flap really lands. A **snip** clips every piece against the cut line, again in each piece's own original coordinates. An **unfold** applies the most recent reflection once more to the pieces that moved, because reflecting twice in the same line puts everything back where it was.

Since pieces are only ever divided by straight lines, they stay convex, and splitting a convex polygon by a line is about ten lines of code. When the paper is fully unfolded, every reflection has been undone, so the remaining pieces sit exactly where they started. Their shared edges are the creases you see in the finished shape.

<p><a class="btn" href="/apps/fold-and-snip/" style="text-decoration: none; display: inline-block;">Open Fold and Snip &rarr;</a></p>
