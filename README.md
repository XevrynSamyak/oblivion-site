# Oblivion

The marketing site for [oblivion.menu](https://oblivion.menu). Static HTML,
one stylesheet, one script. No build step, no dependencies, nothing to
install.

```
index.html            home
purchase/index.html   pricing
credits/index.html    credits and the feedback form
assets/site.css       tokens, the glass material, the acts
assets/site.js        the WebGL2 field, scroll, the odometer
serve.mjs             static server with directory indexes
```

## Run it

```bash
node serve.mjs
```

Open <http://localhost:4173>. `/purchase/` resolves to
`purchase/index.html`. Asset paths are root-absolute, so the site expects to
live at a domain root rather than in a subfolder. Edits are live on reload.

## How the ground works

One fixed `<canvas>` draws everything behind the page in two passes.

1. **The field.** Domain-warped fbm noise, five octaves, rendered to an
   off-screen texture at 0.85 resolution. Under full is deliberate: the
   softness is the look, and the headroom pays for the second pass.
2. **The composite.** That texture upscaled, with the glass body drawn as a
   superellipse SDF that refracts it. Because the glass is a body *in* the
   shader rather than a sprite over it, what you see through it is the field
   as it is this frame, with per-channel dispersion at the rim.

The ground is lit from the middle, a wide radial ramp from cobalt through
deep navy to near-black, with soft fog drifting over it. The fog modulates
the lamp rather than being the subject.

The palette is declared twice, as custom properties in `site.css` and as
`const vec3` in the field shader. Change a stop in one and change it in the
other.

The glass body's position comes from `[data-glass-body]`, an empty element
that reserves the footprint. Layout decides where it goes; the shader reads
that rect each frame. Move the element and the glass follows.

## Pages

Three, each linking to the other two plus the Discord, so any page reaches
any other in one click. They share one stylesheet and one script. The shell
(head, masthead, footer) is duplicated per page rather than templated,
because three static pages do not earn a build step. Change the masthead and
change it three times.

`site.js` runs on all three and guards every page-specific block, so the
copy button, the pricing toggle and the feedback form each no-op where they
do not exist.

**The feedback form does not send.** `FEEDBACK_ENDPOINT` in `site.js` is
empty; set it to a URL that accepts a JSON POST of `{kind, message}`. Until
then the form says plainly that nothing was sent, points at the Discord and
selects the message so it can be copied. A form that silently swallows a bug
report is worse than no form.

## The mark

The Oblivion mark, three filled paths on a `-112 -112 224 224` viewBox. It
appears three ways from that one set of paths: a gradient fill in the
masthead, a favicon, and a liquid-glass body in the sign-off, where the
paths are used twice over, once as a mask for the refracting interior and
once stroked for the rim. Stroking the same paths the body fills is what
keeps the rim on the silhouette exactly.

## Motion

Three mechanisms. `.lines` wipes display type up from behind a per-line
mask, `[data-rise]` fades everything else in once, and `--p` drives whatever
should keep moving while an act is on screen.

`--p` comes from a damped follower over `scrollY` rather than from `scrollY`
itself, framed in `dt` so it behaves the same at 60 and 120Hz. Everything
scroll-linked inherits that weight from one line. The masthead is the
exception: it is a control, not an effect, so it reads raw scroll and does
not lag.

Page-to-page navigation uses cross-document view transitions. The incoming
page floods in from the point that was clicked. Where the browser does not
support them, `site.js` falls back to a short fade on `data-leaving`.

## Sections

Each `.act` is a scroll budget in `svh`; its `.act-stage` is what stays on
screen while the budget is spent. `site.js` writes `--p` (0 to 1) on every
act each frame and CSS consumes it, so the scroll-linked motion is one
number in JS and all of the styling in CSS.

Two things about act geometry are easy to get wrong. A `--p` fade has to
reach zero near `p = 1`, or the stage sits on screen with nothing left to
read. And consecutive sticky acts overlap by `-32svh`, because an incoming
stage centres its copy and would otherwise clear the fold only halfway
through its slide.

## Accessibility

- Copy never sits on open marble. Every act draws a scrim, and the
  text-dense ledger takes the field out of focus behind it.
- Glass panels carrying body copy use a dark tint rather than the light fill
  the buttons use. Against the brightest part of the field the light fill
  measures 4.19:1 for muted ink, under the 4.5 floor.
- `prefers-reduced-motion` is handled twice: the transition reset in CSS,
  and a branch in `main()` that holds the field on one frame while still
  redrawing on scroll and resize, since `--p` is not a transition.
- Controls under 44px get the hit area through an `::after` widener on
  coarse pointers, without changing their size.
- No WebGL2 means a static CSS ground, not a black page.

## Icons

Line, 1.5px stroke, round joins, drawn with [Lucide](https://lucide.dev)
path data (ISC licence) on a 24px `viewBox` under the `.ico` class.

## Licence

Not open source. The code, the copy and the mark are Oblivion's. Read it,
learn from it, but it is not offered for reuse.
