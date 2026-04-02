# MDX Format Specification (Version 800)
## Warcraft III Binary Model Format

All values are little-endian. Chunks are identified by 4-byte ASCII tags followed by a 4-byte size (uint32).

---

## File Header

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Magic number: `MDLX` |

After the header, the file consists of sequential chunks. Each chunk:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Chunk tag (e.g. `VERS`, `SEQS`) |
| 4 | 4 | uint32 | Chunk size in bytes (excluding tag + size) |
| 8 | ... | ... | Chunk data |

---

## VERS – Version

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Version number. `800` = classic WC3, `900`+ = Reforged |

---

## MODL – Model Info

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 80 | char[80] | Model name (null-padded) |
| 80 | 4 | uint32 | Unknown / animation file name length |
| 84 | 4 | float | Bounds radius |
| 88 | 12 | float[3] | Minimum extent (x, y, z) |
| 100 | 12 | float[3] | Maximum extent (x, y, z) |
| 112 | 4 | uint32 | Blend time |

---

## SEQS – Sequences (Animations)

Chunk contains N sequence blocks, each 132 bytes.

### Single Sequence Block (132 bytes)

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 80 | char[80] | Sequence name (null-padded) |
| 80 | 4 | uint32 | Start time (ms) |
| 84 | 4 | uint32 | End time (ms) |
| 88 | 4 | float | Move speed |
| 92 | 4 | uint32 | Flags. Bit 0: `1` = Non-Looping |
| 96 | 4 | float | Rarity (0.0 = always, higher = less frequent) |
| 100 | 4 | uint32 | Sync point |
| 104 | 4 | float | Bounds radius |
| 108 | 12 | float[3] | Minimum extent (x, y, z) |
| 120 | 12 | float[3] | Maximum extent (x, y, z) |

---

## GLBS – Global Sequences

Chunk contains N uint32 values (4 bytes each).

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Duration of global sequence 0 (ms) |
| 4 | 4 | uint32 | Duration of global sequence 1 (ms) |
| ... | ... | ... | ... |

---

## TEXS – Textures

Chunk contains N texture blocks, each 268 bytes.

### Single Texture Block (268 bytes)

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Replaceable ID. `0`=None, `1`=Team Color, `2`=Team Glow |
| 4 | 260 | char[260] | Texture file path (null-padded) |
| 264 | 4 | uint32 | Flags. Bit 0: Wrap Width, Bit 1: Wrap Height |

---

## MTLS – Materials

Chunk contains variable-sized material blocks.

### Material Header

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size of this material block |
| 4 | 4 | uint32 | Priority plane |
| 8 | 4 | uint32 | Flags (unused in v800) |

Followed by one or more `LAYS` (Layer) sub-chunks.

### LAYS – Layers Sub-chunk

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `LAYS` |
| 4 | 4 | uint32 | Number of layers |

### Single Layer

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size of this layer |
| 4 | 4 | uint32 | Filter mode: `0`=None, `1`=Transparent, `2`=Blend, `3`=Additive, `4`=AddAlpha, `5`=Modulate, `6`=Modulate2x |
| 8 | 4 | uint32 | Shading flags. Bit 0: Unshaded, Bit 1: Sphere Env Map, Bit 4: Two Sided, Bit 5: Unfogged, Bit 6: No Depth Test, Bit 7: No Depth Set |
| 12 | 4 | uint32 | Texture ID (index into TEXS) |
| 16 | 4 | uint32 | Texture animation ID (index into TXAN, `0xFFFFFFFF` = none) |
| 20 | 4 | uint32 | Coord ID (UV channel) |
| 24 | 4 | float | Alpha (`0.0` = transparent, `1.0` = opaque) |

May be followed by animated parameter sub-chunks:

- `KMTA` – Animated alpha (float)
- `KMTF` – Animated texture ID (uint32)

---

## Animated Parameter Block (used in many chunks)

When a property is animated, it uses this structure:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag (e.g. `KMTA`, `KGTR`, `KGRT`) |
| 4 | 4 | uint32 | Number of keyframes |
| 8 | 4 | uint32 | Interpolation type: `0`=None, `1`=Linear, `2`=Hermite, `3`=Bezier |
| 12 | 4 | int32 | Global sequence ID (`-1` = none) |

Followed by N keyframes:

#### None / Linear Keyframe

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | int32 | Time (ms) |
| 4 | varies | ... | Value (size depends on data type) |

#### Hermite / Bezier Keyframe

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | int32 | Time (ms) |
| 4 | varies | ... | Value |
| +N | varies | ... | In-tangent |
| +2N | varies | ... | Out-tangent |

Common data types per tag:

| Tag | Data Type | Size | Description |
|-----|-----------|------|-------------|
| KGTR | float[3] | 12 | Translation (x, y, z) |
| KGRT | float[4] | 16 | Rotation quaternion (x, y, z, w) |
| KGSC | float[3] | 12 | Scale (x, y, z) |
| KGEO | float | 4 | Geoset alpha |
| KGAC | float[3] | 12 | Geoset anim color (r, g, b) 0.0–1.0 |
| KATV | float | 4 | Attachment visibility |
| KMTA | float | 4 | Material alpha |
| KMTF | uint32 | 4 | Material texture ID |
| KLAV | float | 4 | Light visibility |
| KLAC | float[3] | 12 | Light color |
| KLAI | float | 4 | Light intensity |
| KLBC | float[3] | 12 | Light ambient color |
| KLBI | float | 4 | Light ambient intensity |
| KLAS | float | 4 | Light attenuation start |
| KLAE | float | 4 | Light attenuation end |
| KPEV | float | 4 | Particle emitter 2 visibility |
| KP2S | float | 4 | Particle emitter 2 speed |
| KP2R | float | 4 | Particle emitter 2 variation |
| KP2L | float | 4 | Particle emitter 2 latitude |
| KP2G | float | 4 | Particle emitter 2 gravity |
| KP2E | float | 4 | Particle emitter 2 emission rate |
| KP2N | float | 4 | Particle emitter 2 length |
| KP2W | float | 4 | Particle emitter 2 width |
| KRVS | float | 4 | Ribbon visibility |
| KRHA | float | 4 | Ribbon height above |
| KRHB | float | 4 | Ribbon height below |
| KRAL | float | 4 | Ribbon alpha |
| KRCO | float[3] | 12 | Ribbon color |
| KRTX | uint32 | 4 | Ribbon texture slot |
| KCTR | float[3] | 12 | Camera translation |
| KTTR | float[3] | 12 | Camera target translation |
| KCRL | float | 4 | Camera rotation (roll) |

---

## TXAN – Texture Animations

Chunk contains N texture animation blocks.

### Single Texture Animation Block

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |

May contain animated sub-chunks:

- `KTAT` – Translation (float[3])
- `KTAR` – Rotation (float[4])
- `KTAS` – Scaling (float[3])

---

## GEOS – Geosets (Meshes)

Chunk contains N geoset blocks.

### Single Geoset Block

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |

#### VRTX – Vertices

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `VRTX` |
| 4 | 4 | uint32 | Number of vertices (N) |
| 8 | N×12 | float[3]×N | Vertex positions (x, y, z) |

#### NRMS – Normals

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `NRMS` |
| 4 | 4 | uint32 | Number of normals (N) |
| 8 | N×12 | float[3]×N | Normal vectors (x, y, z) |

#### PTYP – Primitive Types

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `PTYP` |
| 4 | 4 | uint32 | Count |
| 8 | 4×N | uint32×N | Primitive type. `4` = Triangles |

#### PCNT – Primitive Counts

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `PCNT` |
| 4 | 4 | uint32 | Count |
| 8 | 4×N | uint32×N | Number of indices per primitive group |

#### PVTX – Primitive Vertices (Indices)

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `PVTX` |
| 4 | 4 | uint32 | Number of indices (N) |
| 8 | N×2 | uint16×N | Triangle indices |

#### GNDX – Group Indices

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `GNDX` |
| 4 | 4 | uint32 | Number of entries (N, one per vertex) |
| 8 | N×1 | uint8×N | Matrix group index per vertex |

#### MTGC – Matrix Group Counts

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `MTGC` |
| 4 | 4 | uint32 | Number of groups (N) |
| 8 | N×4 | uint32×N | Number of matrices per group |

#### MATS – Matrix Indices

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `MATS` |
| 4 | 4 | uint32 | Number of indices (N) |
| 8 | N×4 | uint32×N | Bone/node object IDs |

#### Geoset Footer

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Material ID (index into MTLS) |
| 4 | 4 | uint32 | Selection group |
| 8 | 4 | uint32 | Selection flags. `0`=None, `4`=Unselectable |
| 12 | 4 | float | Bounds radius |
| 16 | 12 | float[3] | Min extent |
| 28 | 12 | float[3] | Max extent |
| 40 | 4 | uint32 | Number of extent sets (= number of sequences) |
| 44 | N×28 | ... | Per-sequence extents (bounds radius + min + max each) |

#### UVAS – UV Coordinate Sets

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `UVAS` |
| 4 | 4 | uint32 | Number of UV sets |

Each UV set:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | char[4] | Tag: `UVBS` |
| 4 | 4 | uint32 | Number of UVs (N, same as vertex count) |
| 8 | N×8 | float[2]×N | UV coordinates (u, v) |

---

## GEOA – Geoset Animations

Chunk contains N geoset animation blocks.

### Single Geoset Animation Block

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | 4 | float | Static alpha (`1.0` = opaque) |
| 8 | 4 | uint32 | Flags. Bit 0: Use Color, Bit 1: Use Alpha |
| 12 | 12 | float[3] | Static color (b, g, r) — note: BGR order, 0.0–1.0 |
| 24 | 4 | uint32 | Geoset ID (index into GEOS) |

May contain animated sub-chunks:

- `KGAO` – Alpha (float)
- `KGAC` – Color (float[3], BGR)

---

## Node (Common Object Header)

Used by Bones, Helpers, Lights, Attachments, Particle Emitters, etc.

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size of node data |
| 4 | 80 | char[80] | Node name (null-padded) |
| 84 | 4 | uint32 | Object ID |
| 88 | 4 | uint32 | Parent ID (`0xFFFFFFFF` = no parent) |
| 92 | 4 | uint32 | Flags (see below) |

### Node Flags

| Bit | Value | Description |
|-----|-------|-------------|
| 0 | 0x0001 | Helper |
| 1 | 0x0002 | Dont Inherit Translation |
| 2 | 0x0004 | Dont Inherit Rotation |
| 3 | 0x0008 | Dont Inherit Scaling |
| 4 | 0x0010 | Billboarded |
| 5 | 0x0020 | Billboarded Lock X |
| 6 | 0x0040 | Billboarded Lock Y |
| 7 | 0x0080 | Billboarded Lock Z |
| 8 | 0x0100 | Bone |
| 9 | 0x0200 | Light |
| 10 | 0x0400 | Event Object |
| 11 | 0x0800 | Attachment |
| 12 | 0x1000 | Particle Emitter |
| 13 | 0x2000 | Collision Shape |
| 14 | 0x4000 | Ribbon Emitter |
| 15 | 0x8000 | (Unused/Emitter uses TGA) |
| 16 | 0x10000 | Emitter Uses MDL |
| 17 | 0x20000 | Unfogged |
| 18 | 0x40000 | (Unused) |
| 19 | 0x80000 | (Unused) |

May contain animated sub-chunks:

- `KGTR` – Translation (float[3])
- `KGRT` – Rotation (float[4] quaternion)
- `KGSC` – Scale (float[3])

---

## BONE – Bones

Chunk contains N bone blocks.

### Single Bone

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | ... | Node | Standard node header (see above) |
| +0 | 4 | uint32 | Geoset ID (which geoset this bone affects, `0xFFFFFFFF` = none) |
| +4 | 4 | uint32 | Geoset animation ID (`0xFFFFFFFF` = none) |

---

## HELP – Helpers

Chunk contains N helper blocks. Each is just a Node with no additional data.

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | ... | Node | Standard node header |

---

## ATCH – Attachments

Chunk contains N attachment blocks.

### Single Attachment

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | ... | Node | Standard node header |
| +0 | 260 | char[260] | Attachment path (null-padded) |
| +260 | 4 | uint32 | Attachment ID |

May contain: `KATV` – Visibility (float)

---

## PIVT – Pivot Points

Chunk contains N pivot points (one per node, in object ID order).

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | N×12 | float[3]×N | Pivot point positions (x, y, z) |

---

## LITE – Lights

### Single Light

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | ... | Node | Standard node header |
| +0 | 4 | uint32 | Type: `0`=Omnidirectional, `1`=Directional, `2`=Ambient |
| +4 | 4 | float | Attenuation start |
| +8 | 4 | float | Attenuation end |
| +12 | 12 | float[3] | Color (r, g, b) 0.0–1.0 |
| +24 | 4 | float | Intensity |
| +28 | 12 | float[3] | Ambient color (r, g, b) |
| +40 | 4 | float | Ambient intensity |

May contain animated sub-chunks: `KLAS`, `KLAE`, `KLAC`, `KLAI`, `KLBC`, `KLBI`, `KLAV`

---

## PRE1 – Particle Emitters (Type 1)

### Single Particle Emitter 1

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | ... | Node | Standard node header |
| +0 | 4 | float | Emission rate |
| +4 | 4 | float | Gravity |
| +8 | 4 | float | Longitude |
| +12 | 4 | float | Latitude |
| +16 | 260 | char[260] | Particle file path |
| +276 | 4 | float | Life span |
| +280 | 4 | float | Initial velocity |

May contain animated sub-chunks and `KPEV` (visibility)

---

## PRE2 – Particle Emitters 2

### Single Particle Emitter 2

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | ... | Node | Standard node header |
| +0 | 4 | float | Speed |
| +4 | 4 | float | Variation |
| +8 | 4 | float | Latitude |
| +12 | 4 | float | Gravity |
| +16 | 4 | float | Life span |
| +20 | 4 | float | Emission rate |
| +24 | 4 | float | Length |
| +28 | 4 | float | Width |
| +32 | 4 | uint32 | Filter mode (same as material filter mode) |
| +36 | 4 | uint32 | Rows |
| +40 | 4 | uint32 | Columns |
| +44 | 4 | uint32 | Head or Tail: `0`=Head, `1`=Tail, `2`=Both |
| +48 | 4 | float | Tail length |
| +52 | 4 | float | Time (mid-point 0.0–1.0) |

#### Segment Colors (3 segments × RGB)

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +56 | 12 | float[3] | Start color (r, g, b) 0.0–1.0 |
| +68 | 12 | float[3] | Mid color (r, g, b) 0.0–1.0 |
| +80 | 12 | float[3] | End color (r, g, b) 0.0–1.0 |

#### Segment Alphas

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +92 | 1 | uint8 | Start alpha (0–255) |
| +93 | 1 | uint8 | Mid alpha (0–255) |
| +94 | 1 | uint8 | End alpha (0–255) |

#### Segment Scaling

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +95 | 4 | float | Start scale |
| +99 | 4 | float | Mid scale |
| +103 | 4 | float | End scale |

#### UV Animation

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +107 | 12 | uint32[3] | Head life span UV anim (start, end, repeat) |
| +119 | 12 | uint32[3] | Head decay UV anim (start, end, repeat) |
| +131 | 12 | uint32[3] | Tail life span UV anim (start, end, repeat) |
| +143 | 12 | uint32[3] | Tail decay UV anim (start, end, repeat) |

#### Remaining Fields

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +155 | 4 | uint32 | Texture ID |
| +159 | 4 | uint32 | Squirt flag (`1` = squirt) |
| +163 | 4 | uint32 | Priority plane |
| +167 | 4 | uint32 | Replaceable ID |

May contain animated sub-chunks: `KP2S`, `KP2R`, `KP2L`, `KP2G`, `KP2E`, `KP2N`, `KP2W`, `KPEV`

---

## RIBB – Ribbon Emitters

### Single Ribbon Emitter

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | ... | Node | Standard node header |
| +0 | 4 | float | Height above |
| +4 | 4 | float | Height below |
| +8 | 4 | float | Alpha |
| +12 | 12 | float[3] | Color (r, g, b) |
| +24 | 4 | float | Life span |
| +28 | 4 | uint32 | Texture slot |
| +32 | 4 | uint32 | Emission rate |
| +36 | 4 | uint32 | Rows |
| +40 | 4 | uint32 | Columns |
| +44 | 4 | uint32 | Material ID |
| +48 | 4 | float | Gravity |

May contain animated sub-chunks: `KRHA`, `KRHB`, `KRAL`, `KRCO`, `KRTX`, `KRVS`

---

## EVTS – Event Objects

### Single Event Object

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | ... | Node | Standard node header |
| 4 | char[4] | Tag: `KEVT` |
| 4 | 4 | uint32 | Number of event times (N) |
| 8 | 4 | int32 | Global sequence ID (`-1` = none) |
| 12 | N×4 | uint32×N | Event times (ms) |

Event names encode their type:
- `SNDxNNNN` – Sound, x=channel, NNNN=sound ID
- `FTPx` – Footprint
- `SPLx` – Splat (blood, etc.)
- `UBRx` – UberSplat

---

## CLID – Collision Shapes

### Single Collision Shape

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | ... | Node | Standard node header |
| +0 | 4 | uint32 | Type: `0`=Box, `1`=Plane, `2`=Sphere, `3`=Cylinder |

If Box/Plane/Cylinder:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +4 | 12 | float[3] | Vertex 1 (x, y, z) |
| +16 | 12 | float[3] | Vertex 2 (x, y, z) |

If Sphere:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +4 | 12 | float[3] | Center (x, y, z) |

If Sphere or Cylinder, additional:

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| +N | 4 | float | Bounds radius |

---

## CAMS – Cameras

### Single Camera

| Offset | Size | Type | Description |
|--------|------|------|-------------|
| 0 | 4 | uint32 | Inclusive size |
| 4 | 80 | char[80] | Camera name (null-padded) |
| 84 | 12 | float[3] | Position (x, y, z) |
| 96 | 4 | float | Field of view (radians) |
| 100 | 4 | float | Far clipping plane |
| 104 | 4 | float | Near clipping plane |
| 108 | 12 | float[3] | Target position (x, y, z) |

May contain animated sub-chunks: `KCTR`, `KTTR`, `KCRL`

---

## Chunk Order (typical)

1. `VERS` – Version
2. `MODL` – Model info
3. `SEQS` – Sequences
4. `GLBS` – Global sequences
5. `TEXS` – Textures
6. `MTLS` – Materials
7. `TXAN` – Texture animations
8. `GEOS` – Geosets
9. `GEOA` – Geoset animations
10. `BONE` – Bones
11. `HELP` – Helpers
12. `ATCH` – Attachments
13. `PIVT` – Pivot points
14. `EVTS` – Event objects
15. `LITE` – Lights
16. `PRE1` – Particle emitters 1
17. `PRE2` – Particle emitters 2
18. `RIBB` – Ribbon emitters
19. `CAMS` – Cameras
20. `CLID` – Collision shapes

---

## Coordinate System

MDX uses a different coordinate system than 3ds Max:

| MDX | 3ds Max |
|-----|---------|
| X | -Y |
| Y | X |
| Z | Z |

Conversion: `MDX_x = -Max_y`, `MDX_y = Max_x`, `MDX_z = Max_z`

---

## Notes

- All strings are null-padded to their fixed length
- All multi-byte values are little-endian
- Times are in milliseconds
- Colors are float[3] in range 0.0–1.0 (except segment alpha which is uint8 0–255)
- Object IDs are sequential integers starting at 0, assigned in order of appearance
- Parent ID of `0xFFFFFFFF` (-1 as signed) means no parent (root level)
- Global sequence ID of `-1` means the animation is not tied to a global sequence
- Extents use the Wc3 coordinate system (not Max)
