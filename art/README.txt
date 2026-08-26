EXPLODING CATAN — CUSTOM ART
============================

Drop files in this folder using the exact names below, then reload the game.
Anything missing falls back to the built-in drawing, so partial sets are fine —
add one hex tile and only that hex changes.

To see which files were found, open the browser console and run showArt().


HEX TERRAIN — PNG or JPG, square, 512x512
-----------------------------------------
  hex-wood.png
  hex-brick.png
  hex-sheep.png
  hex-wheat.png
  hex-ore.png
  hex-desert.png

Send SQUARES with the art bleeding to all four edges. Do NOT pre-cut a hexagon
— the game clips the hex out for you, which avoids hairline seams between tiles.

The hexes are POINTY-TOP (points at top and bottom). In a 512x512 square the
visible hexagon is the centred 443x512, so roughly 35px is trimmed off the left
and right. Keep important detail central. Transparency is not needed.

If you'd rather compose exactly to the hex, use 444x512 instead.

Always draw POINTY-TOP, whatever board you have in mind. The 5-6 player
extension board is laid on its side so it comes out wider than it is tall,
which makes its hexes flat-topped — and the game turns your tile a quarter turn
to suit, rather than re-cropping it. So the same file serves both boards, and
the trim stays on the left and right where you left room for it. The one thing
that follows: on the extension board your art is seen a quarter turn over, so
avoid anything that only reads one way up (lettering, a horizon).


RESOURCE CARDS — PNG, portrait, 300x420 (5:7)
----------------------------------------------
  res-wood.png
  res-brick.png
  res-sheep.png
  res-wheat.png
  res-ore.png
  res-back.png

These fill the five slots along the bottom bar. The count and the resource
name are drawn on top of the art, so keep the lower third relatively calm or
the number gets hard to read. Rendered at 52x70, so 300x420 is plenty.

res-back.png is the BACK of a resource card, and is used in one place only:
the card the robber takes, flying from the victim to the thief. Every other
exchange in the game is public and travels face up — a Favor, an Exploding
Kitten, an Attack, a seven, a trade. The robbery is the one nobody else is
entitled to see, so it is the one that needs a back. Until the file exists the
game draws a plain dark card instead, which works but is not much to look at.


PIECES — SVG (or PNG), transparent background
---------------------------------------------
  piece-settlement.svg
  piece-city.svg
  piece-road.svg
  piece-robber.svg

These are used as a SILHOUETTE: the game floods them with the player's colour
and adds a dark outline. The colour you draw them in does not matter at all —
only the shape and the transparent background. Black is fine.

  - No background rectangle behind the shape.
  - Export with "Presentation Attributes", NOT "Internal CSS". Illustrator's
    default writes <style>.st0{...}</style>, and since these get inlined once
    per player the class names collide. Same problem with <defs> ids.
  - Flatten to a single <path> where you can.
  - Square viewBox (e.g. 0 0 100 100). Any size — it gets scaled.

piece-road.svg is stretched along the edge, so draw it HORIZONTAL in a wide
viewBox (e.g. 0 0 100 20). It renders 18px thick.

Rendered sizes: settlement 28px, city 34px, robber 34px.


NUMBER TOKEN — PNG, square, 256x256, transparent
------------------------------------------------
  token-blank.png

Just the blank disc. The number and pip dots stay procedural so they remain
legible, and are drawn on top.


CARD FACES — PNG, portrait, 500x700 (5:7)
------------------------------------------
  card-implode.png            card-defuse.png
  card-vp.png                 card-alter.png
  card-skip.png               card-attack.png
  card-nope.png               card-favor.png
  card-explode.png            card-reverse.png

  card-knight-beard.png       card-knight-rainbow.png
  card-knight-watermelon.png  card-knight-taco.png
  card-knight-potato.png

  card-back.png

Full-bleed art, no transparency needed — rounded corners are applied in CSS.
These fill the kitten cards along the bottom bar (rendered 52x70). Clicking a
playable card plays it; clicking a card you cannot play enlarges it instead.

card-back.png is used for the deck in the bottom-right corner, which is
rendered at 74x104 — so it can be the same 5:7 art as the faces.

Small labels ("next turn", "1 VP", "react") are drawn in the top-right corner
of a card when relevant, so avoid putting anything critical there.


PROFILE PICTURES — in profile/, PNG, square, 256x256
----------------------------------------------------
  profile/1.png  …  profile/40.png

These live in a FOLDER OF THEIR OWN — art/profile/ — so that actual pictures
of people stay separate from hex tiles and card faces, and it is the ONLY
place the game looks for a portrait. Nothing above is ever offered as a face.
See the README in there. Optional, and the only optional set here; they are
not counted in the "N of M found" figure, which reports them separately.

An empty folder means everybody plays as their initial on their seat colour,
which is a perfectly good answer. It used to fall back to offering the card
faces and tiles above, and that stopped once there were real pictures to
offer.

Shown in a CIRCLE, about 64px across, so keep the subject central and expect
the corners to be cut off.

Only the picture's number travels between browsers — not the file — so
everybody does not need the same folder. Somebody playing with a picture you
have not got shows up on your screen as their initial on their seat colour,
which is also what everyone gets before they pick anything.


NOTES
-----
- 404s in the browser console for missing art are expected and harmless.
- With an art folder the game is no longer a single portable file. When you
  want to hand it to someone, ask and it can be baked back into one HTML file
  with everything embedded.
