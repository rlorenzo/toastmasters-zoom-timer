# Design Guide

Distilled from the Toastmasters International Brand Manual (Version 2.0, Rev. 03/2026).
Source: <https://content.toastmasters.org/image/upload/02330-001-0001-brand-manual.pdf>

This document captures the brand rules relevant to building branded digital tools
like this timer. For trademark use, contact brand@toastmasters.org; official
materials require a Trademark Use Request.

---

## Brand Platform

**Core values:** Integrity, Respect, Service, Excellence.

**Brand promise:** "Empowering individuals through personal and professional development."

**Approved phrases** (use one per piece, with good contrast, never covering faces):
Find Your Voice; Relax, present confidently; Relax, speak confidently;
Communicate Confidently(R); 100 Years of Confident Voices; Find your confidence;
Become a better leader; Invest in a Brighter Future.

---

## Voice and Tone

The brand personality leads with leadership, dedication, and empowerment.

- **Voice:** confident and compassionate; clear yet respectful; friendly yet professional.
- **Tone:** positive, upbeat, enthusiastic; serious when necessary; open to exchange.

Applied to UI copy: keep labels clear and encouraging, never terse or cold. Button
text and guidance should sound supportive of a speaker, not clinical.

---

## Color Palette

### Primary colors

| Name        | Hex       | RGB             | CMYK              | Pantone |
|-------------|-----------|-----------------|-------------------|---------|
| Loyal Blue  | `#004165` | 0, 65, 101      | 100, 43, 12, 56   | 302     |
| True Maroon | `#772432` | 119, 36, 50     | 12, 95, 59, 54    | 188     |
| Cool Gray   | `#A9B2B1` | 169, 178, 177   | 23, 7, 12, 18     | 442     |
| Happy Yellow| `#F2DF74` | 242, 223, 116   | 0, 5, 57, 0       | 127     |

- **Loyal Blue** and **True Maroon** are the workhorse colors for headers and backgrounds.
- **Happy Yellow** is the accent / highlight color.
- **Cool Gray** is a neutral for backgrounds and large areas.

Specify Hex for web, RGB for digital, CMYK for 4-color print, Pantone for spot color.

### Gradients

| Gradient          | Stops                                         |
|-------------------|-----------------------------------------------|
| Loyal Blue        | Loyal Blue `#004165` to Blissful Blue `#006094` |
| True Maroon       | Deep Maroon `#3B0104` to Rich Maroon `#781327`  |
| Cool Gray         | Cool Gray `#A9B2B1` to Fair Gray `#F5F5F5`      |

Gradients may be linear or radial. Cool Gray gradient opacity can be layered over imagery.

---

## Typography

| Role            | Primary       | Approved alternates                  |
|-----------------|---------------|--------------------------------------|
| Headlines / CTA | Gotham        | Montserrat (when Gotham unavailable) |
| Body copy       | Myriad Pro    | Source Sans Pro; Arial, Segoe UI (tertiary) |

- **Gotham** is the primary typeface: a geometric sans-serif for headlines, subheads,
  and calls to action. Available weights: Light, Book, Medium, Bold, Black. Condensed exists.
- **Myriad Pro** is the body-copy typeface used throughout the manual itself.
- Fonts must be used in their standard weights and styles. Do not stretch, condense
  beyond the supplied condensed cuts, or otherwise distort the typefaces.

For a no-build web app without licensed fonts, the brand-safe stack is:
`Montserrat` (or system geometric sans) for headings, falling back to
`-apple-system, Segoe UI, Arial, sans-serif` for body.

---

## Logo

The Toastmasters logo is the stylized blue globe emblem with curved meridian lines,
paired with the "TOASTMASTERS INTERNATIONAL" wordmark.

**Approved color variations:** full color, all white, all black. The logo should
always carry the registered trademark symbol.

**Clear space:** maintain space around the wordmark at least equal to the height of
the capital "T" in the wordmark.

**Minimum size:** 72 pixels wide for web; 3/4 inch wide for print (1 inch for the
Pathways logo).

**Don'ts:**

- Don't recolor the logo; use only approved colors.
- Don't alter, condense, or distort the wordmark.
- Don't add visual effects (shadows, glows, etc.).
- Don't rotate the wordmark.
- Don't place the logo on a busy background.
- Don't change the typefaces.

Note: the official globe logo is a trademarked asset and should not be redrawn or
approximated. Use the supplied logo files, or use brand colors and type without
reproducing the emblem.

---

## Application to This Project

This timer is an unofficial club tool, not official Toastmasters collateral, so it
should respect the brand without reproducing trademarked assets.

- **Palette:** prefer Loyal Blue `#004165` (and its gradient to Blissful Blue
  `#006094`) for backgrounds and chrome; use Happy Yellow `#F2DF74` as the accent
  for primary actions and highlights. The current UI accent gold `#c8a84b` is not a
  brand color and should migrate toward Happy Yellow.
- **Timing-state colors** (green / yellow / red) come from the physical Toastmasters
  timing-light convention, not the brand palette; keep them only where they signal
  speech timing. Happy Yellow is close to the timing yellow and can serve both roles.
- **Type:** use a geometric sans (Montserrat or system) for headings to echo Gotham;
  keep body copy in a clean sans fallback.
- **Logo / favicon:** do not redraw the globe emblem. The favicon uses a generic
  timing symbol (a stopwatch) in brand colors instead of the trademarked logo.
- **Copy:** keep guidance supportive and clear, matching the confident, friendly,
  encouraging brand voice.
