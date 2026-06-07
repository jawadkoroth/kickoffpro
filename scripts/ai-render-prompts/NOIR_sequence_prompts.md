# KickoffPro — Linen Shirt Sequence: AI Render Prompt Pack
## Production-Grade Frame Sequence for Scroll-Driven Storytelling
### Version 1.0 | 60 Frames | 800×1000 or 1000×1250

---

## OVERVIEW

This document contains everything needed to generate the 60-frame production
render sequence for the KickoffPro landing page interactive product storytelling section.

Target engine: `ImageSequenceEngine` in `src/components/sequence/`  
Output folder: `public/sequences/linen-shirt/`  
Naming: `frame_0001.webp` → `frame_0060.webp`  
Format: WebP (preferred) or PNG  
Resolution: 800×1000 minimum | 1000×1250 preferred

---

## CRITICAL CONSISTENCY RULES

These rules apply to EVERY single frame. Breaking any of them causes
visible flicker or warping during scroll interpolation.

1. **Camera lock** — identical camera position, focal length, and framing in all 60 frames.  
   Camera: fixed at ~1.6m distance, focal length 85mm equivalent, center-framed.  
   Do NOT let the AI "drift" the camera between frames.

2. **Lighting lock** — identical light rig in all 60 frames EXCEPT the rim light angle,
   which rotates with the shirt (see per-frame instructions below).

3. **Background lock** — `#0A0A0A` to `#0D0D0D` throughout. No variation.

4. **Shirt scale lock** — shirt occupies 65–75% of vertical frame height in all frames.
   Top of collar: ~12–15% from top edge.  
   Hem: ~88–92% from top edge.  

5. **No face, no mannequin details, no brand text, no props** — shirt only, floating.

6. **Annotation clearance zones** — keep these regions visually clean (low contrast,
   minimal texture) so annotation overlays read clearly:
   - Collar area: top 22% of shirt height
   - Left chest: 35–55% height, 30–50% width
   - Right side seam: 55–70% height, 60–75% width
   - Lower hem area: bottom 15% of shirt

---

## MASTER PROMPT TEMPLATE

Use this as the base. Append the per-frame ANGLE INSTRUCTION from the table below.

```
Ultra-high-quality luxury fashion editorial photograph of a black linen dress shirt, 
floating against a near-black cinematic studio background (#0A0A0A), 
no mannequin, no model, shirt appears to float naturally with subtle gravity drape.

SHIRT: Black long-staple French linen, structured collar (not spread), 
front button placket, long sleeves hanging naturally, relaxed tailored silhouette, 
subtle natural drape folds across chest and waist, matte luxury fabric, 
visible linen weave texture under soft directional light.

ENVIRONMENT: Ultra-dark cinematic studio, deep blacks, 
soft volumetric atmosphere, no floor visible, no visible props or studio equipment, 
no background gradients, no colored light spill, pure black void.

LIGHTING: Three-point luxury fashion lighting setup —
  KEY LIGHT: Large soft-box at [ANGLE_INSTRUCTION] 45° elevation, 
             soft diffused, reveals shirt texture on chest and shoulders  
  RIM LIGHT: Thin silver rim from opposite side of key light, 
             defines shirt silhouette against background, very subtle
  FILL LIGHT: Ultra-subtle ambient fill, barely above noise floor, 
              preserves deep shadow areas

COMPOSITION: Perfectly centered, vertical portrait orientation 800×1000px, 
shirt occupies 68% of vertical space, generous negative space at all four edges 
for overlay annotations, clean silhouette separation from background.

STYLE: Saint Laurent campaign, luxury editorial, Apple product storytelling, 
cinematic monochrome, expensive, restrained, fashion-first.

TECHNICAL: 85mm equivalent focal length, f/8, no visible grain, 
photorealistic or near-photorealistic rendering, sharp fabric texture, 
accurate linen fiber detail, no artifacts, no watermarks, no UI elements.

[ANGLE_INSTRUCTION]
```

---

## PER-FRAME ANGLE TABLE

The shirt rotates through a controlled **140° luxury arc** then eases back ~20°.
Motion: front → ¾-left → side → ¾-back → partial-back → gentle return.

The key light rotates OPPOSITE to the shirt at 60% of the shirt rotation speed
to maintain consistent front-face illumination.

| Frame Range | Shirt Yaw | Description | Key Light Direction |
|-------------|-----------|-------------|---------------------|
| 01–05 | 0°–12° | Full front face, button placket centered | Left of camera, 40° |
| 06–10 | 12°–25° | Slight left turn begins, collar angle visible | Left of camera, 32° |
| 11–15 | 25°–42° | ¾ angle, left shoulder advances, right recedes | Left of camera, 22° |
| 16–20 | 42°–58° | ¾-left, collar side detail fully visible | Center-left, 15° |
| 21–25 | 58°–75° | Approaching side view, shoulder seam prominent | Center, 5° |
| 26–30 | 75°–90° | True side view, full shoulder line, sleeve drape | Center-right, -5° |
| 31–35 | 90°–105° | Past side, back panel begins to appear | Right of camera, -12° |
| 36–40 | 105°–118° | ¾-back-left, back yoke visible | Right of camera, -20° |
| 41–45 | 118°–128° | Deeper ¾-back, back texture visible | Right of camera, -28° |
| 46–50 | 128°–136° | Near partial-back, max rotation | Far right, -35° |
| 51–55 | 136°–140° | Peak rotation, 140°, back center visible | Far right, -38° |
| 56–60 | 140°–120° | Luxury ease-back — shirt returns ~20°, cinematic deceleration | Right-center, -28° |

### Per-frame angle instruction text (append to master prompt):

**Frames 01–05:**  
`ANGLE: Shirt faces directly toward camera, 0° rotation. Centered composition. Full front view. Button placket runs exactly down center vertical axis.`

**Frame 06:**  
`ANGLE: Shirt rotated 12° to its left (clockwise from above). Slight left shoulder advance. Right chest recedes very slightly.`

**Frame 10:**  
`ANGLE: Shirt rotated 25° to its left. Left collar point slightly visible. Right chest panel beginning to foreshorten.`

**Frame 15:**  
`ANGLE: Shirt rotated 42° to its left. Clear ¾-view. Left shoulder fully advanced. Right sleeve partially foreshortened. Collar left side prominent.`

**Frame 20:**  
`ANGLE: Shirt rotated 58°. Deep ¾-view approaching side. Left side seam clearly visible. Right sleeve draped behind body line.`

**Frame 26:**  
`ANGLE: Shirt rotated 75°. Near-pure side view. Full shoulder seam length visible left-to-right. Both sleeves visible in profile.`

**Frame 30:**  
`ANGLE: Shirt rotated 90°. True side view. Maximum shoulder width silhouette. Button placket runs diagonally across frame.`

**Frame 35:**  
`ANGLE: Shirt rotated 105°. Past side view. Back right panel beginning to appear. Back collar area starting to show.`

**Frame 40:**  
`ANGLE: Shirt rotated 118°. ¾-back-left view. Back yoke clearly visible. Front mostly hidden. Collar back seam prominent.`

**Frame 50:**  
`ANGLE: Shirt rotated 136°. Near partial-back view. Back panel dominant. Rear armhole seam visible. Center back seam clear.`

**Frame 55:**  
`ANGLE: Shirt rotated 140°. Maximum rotation. Back panel fully featured. Front panel mostly foreshortened and not visible.`

**Frame 60:**  
`ANGLE: Shirt returned to 120° rotation. Eased back from maximum. ¾-back view, slightly more than frame 40. Motion has decelerated — convey stillness returning.`

---

## CONSISTENCY TECHNIQUE BY TOOL

### Midjourney (Recommended: v6.1+)

Use `--sref` (style reference) with your first approved frame for all subsequent frames.
Use `--cref` (character reference) to lock shirt appearance.

```
[MASTER_PROMPT + ANGLE_INSTRUCTION] --ar 4:5 --v 6.1 --sref [frame_0001_url] --cref [frame_0001_url] --stylize 200 --no watermark, text, logo, mannequin, model
```

Workflow:
1. Generate frame 01 (front view) — approve one version
2. Use that as `--sref` and `--cref` for ALL remaining frames
3. Batch-run all 60 with consistent seed: `--seed [your_seed]`
4. Use same seed for all frames to maximise consistency

### DALL-E 3 (via API)

DALL-E 3 has no native style-lock. Workaround:
1. Include a base64-encoded reference image in the system prompt  
2. Use identical prompt text for all frames  
3. Run at temperature 0 where possible  
4. Post-process through img2img with strength 0.25 to regularise

DALL-E 3 is NOT recommended for this sequence — use Midjourney or SD.

### Stable Diffusion (ComfyUI / A1111)

Best option for full consistency control.

**Recommended model:** `Realistic Vision v6.0` or `epiCRealism`  
**Sampler:** DPM++ 2M Karras | **Steps:** 30 | **CFG:** 7  

Consistency method:
1. Generate frame 01 with a fixed seed
2. Use IP-Adapter + Reference-Only ControlNet for frames 02–60:
   - IP-Adapter weight: 0.65
   - Reference-Only ControlNet weight: 0.8
3. Use lineart/canny ControlNet for silhouette consistency across angle changes
4. Each frame: extract edge map from previous frame, feed into ControlNet

**ComfyUI workflow:** standard IP-Adapter + ControlNet Canny pipeline.

---

## BATCH RENAME SCRIPT

After generating images with any tool, run this to rename them correctly:

```bash
# Usage: place all generated images in a temp folder, named by tool output
# Run from project root:
node scripts/ai-render-prompts/batch-rename.mjs ./temp-renders ./public/sequences/linen-shirt
```

See `batch-rename.mjs` in this folder.

---

## QUALITY CHECKLIST (per frame before accepting)

- [ ] Background is near-black (#0A–0D0D0D range only)
- [ ] Shirt collar shape is consistent with adjacent frames
- [ ] Shirt hem position matches other frames (±2% tolerance)
- [ ] Sleeve silhouette has no unexplained changes
- [ ] No text, watermarks, logos visible
- [ ] No mannequin neck/head stub visible
- [ ] Lighting direction consistent with frame range spec
- [ ] Rim light clearly separates shirt from background
- [ ] Linen texture visible on chest area
- [ ] Frame is sharp (not motion-blurred or defocused)

---

## POST-PROCESSING NOTES

After generating all 60 frames:

1. **Resize to exactly 800×1000** (or 1000×1250) — consistent dimensions are critical
2. **Convert to WebP at quality 82–88** — target 60–100 KB per frame
3. **No watermarks** — strip all metadata
4. **Rename** using `batch-rename.mjs` or manually to `frame_0001.webp` etc.
5. **Drop into** `public/sequences/linen-shirt/` — engine auto-discovers them

Command to convert + resize + compress (requires ImageMagick):
```
magick mogrify -resize 800x1000^ -gravity center -extent 800x1000 -format webp -quality 85 *.png
```

Or using `cwebp`:
```
for f in *.png; do cwebp -q 85 "$f" -o "${f%.png}.webp"; done
```

---

## FUTURE SEQUENCE SLOTS

To add a new product sequence (e.g. hoodie, jacket):

1. Create `/public/sequences/[product-slug]/frame_0001.webp` etc.
2. In `ProductStorySection.tsx`, update `SEQUENCE_CONFIG.framePrefix`
3. Update `ANNOTATIONS` array with new hotspot positions
4. No engine changes required

Reserved slots:
- `/sequences/linen-shirt/` — current
- `/sequences/black-hoodie/` — next
- `/sequences/wool-overshirt/` — future
- `/sequences/cargo-trouser/` — future
