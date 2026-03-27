# W3X Map Format Documentation

## File: `claude_map.w3x` — Warcraft III Map Archive

**File Size:** 32,357 bytes (31.6 KB)
**Map Name:** Еще одна карта *(Russian: "Yet another map")*
**Max Players:** 1
**Tileset:** Lordaeron Summer (L)
**Playable Area:** 52×52 tiles

---

## 1. Format Overview

A `.w3x` file is a Warcraft III Expansion (The Frozen Throne) map container. It consists of two layers: an **HM3W header** (map metadata at the file level) followed by an **MPQ archive** containing all map data files. Classic (Reign of Chaos) maps use the `.w3m` extension instead.

### Top-Level Structure

```
┌──────────────────────────────────────────────────┐
│ HM3W Header (512 bytes, padded)                  │
│   Magic "HM3W" + map name + flags + max players  │
├──────────────────────────────────────────────────┤
│ MPQ Archive (remainder of file)                   │
│   Header → File Data → Hash Table → Block Table   │
│   Contains 16 internal files                      │
└──────────────────────────────────────────────────┘
```

All multi-byte integers are **little-endian**. Strings are **null-terminated** unless noted. Floating-point values are **IEEE 754 single-precision (32-bit)**.

---

## 2. HM3W Header

**Offset:** `0x00000000`
**Size:** 512 bytes (padded with zeros to 0x200 boundary)

| Offset | Type | Size | Value | Description |
|--------|------|------|-------|-------------|
| 0x00 | char[4] | 4 | `"HM3W"` | Magic signature — identifies TFT map (.w3x). RoC maps use `"HM3W"` as well but are packaged as .w3m |
| 0x04 | uint32 | 4 | 0 | Unknown / reserved (always 0) |
| 0x08 | char[] | var | `"Еще одна карта"` | Map name, null-terminated UTF-8 string |
| var+1 | uint32 | 4 | 0x0000DC10 | Map flags (see flags table below) |
| var+5 | uint32 | 4 | 1 | Maximum number of players |
| var+9 | — | — | 0x00... | Zero-padded to 512 bytes |

### HM3W Flag Bits

| Bit | Hex | Set? | Description |
|-----|-----|------|-------------|
| 0 | 0x0001 | No | Hide minimap in preview screens |
| 1 | 0x0002 | No | Modify ally priorities |
| 2 | 0x0004 | No | Melee map |
| 3 | 0x0008 | No | Playable map size was large (and has since been reduced) |
| 4 | 0x0010 | **Yes** | Masked area is partially visible |
| 5 | 0x0020 | No | Fixed player setting for custom forces |
| 6 | 0x0040 | No | Use custom forces |
| 7 | 0x0080 | No | Use custom techtree |
| 8 | 0x0100 | No | Use custom abilities |
| 9 | 0x0200 | No | Use custom upgrades |
| 10 | 0x0400 | **Yes** | Map properties menu was opened at least once |
| 11 | 0x0800 | **Yes** | Show water waves on cliff shores |
| 12 | 0x1000 | **Yes** | Show water waves on rolling shores |
| 14 | 0x4000 | **Yes** | Unknown (Reforged-related) |
| 15 | 0x8000 | **Yes** | Unknown (Reforged-related) |

---

## 3. MPQ Archive

**Offset:** `0x00000200`
**Size:** 31,845 bytes

MPQ (Mo'PaQ, short for Mike O'Brien Pack) is Blizzard's proprietary archive format used in nearly all classic Blizzard games.

### 3.1 MPQ Header

| Offset (from MPQ start) | Type | Size | Value | Description |
|--------------------------|------|------|-------|-------------|
| 0x00 | char[4] | 4 | `"MPQ\x1A"` | MPQ magic signature |
| 0x04 | uint32 | 4 | 32 | Header size (bytes) |
| 0x08 | uint32 | 4 | 31,845 | Archive size (bytes) |
| 0x0C | uint16 | 2 | 0 | Format version (0 = original MPQ v1) |
| 0x0E | uint16 | 2 | 3 | Block size exponent (sector size = 512 << 3 = **4096 bytes**) |
| 0x10 | uint32 | 4 | 0x00007765 | Hash table offset (from archive start) |
| 0x14 | uint32 | 4 | 0x00007B65 | Block table offset (from archive start) |
| 0x18 | uint32 | 4 | 64 | Hash table entries |
| 0x1C | uint32 | 4 | 16 | Block table entries (= number of files) |

### 3.2 Hash Table

The hash table maps filenames to block table indices. Each entry is 16 bytes, and the table is **encrypted** using the MPQ hash of `"(hash table)"` as the decryption key.

**Location:** Offset `0x7965` from file start (0x7765 from MPQ start)
**Size:** 64 entries × 16 bytes = 1,024 bytes

| Offset | Type | Size | Description |
|--------|------|------|-------------|
| 0x00 | uint32 | 4 | File path hash A (hash type 1) |
| 0x04 | uint32 | 4 | File path hash B (hash type 2) |
| 0x08 | uint16 | 2 | Locale ID (0 = neutral) |
| 0x0A | uint16 | 2 | Platform (0 = default) |
| 0x0C | uint32 | 4 | Block table index (0xFFFFFFFF = empty, 0xFFFFFFFE = deleted) |

Files are looked up by computing `hash(filename, type=0) % table_size` to find the starting slot, then linearly probing until a matching hash A + hash B pair is found.

### 3.3 Block Table

The block table describes each file's location, size, and compression. It is also **encrypted** using the MPQ hash of `"(block table)"`.

**Location:** Offset `0x7D65` from file start (0x7B65 from MPQ start)
**Size:** 16 entries × 16 bytes = 256 bytes

| Offset | Type | Size | Description |
|--------|------|------|-------------|
| 0x00 | uint32 | 4 | File data offset (from archive start) |
| 0x04 | uint32 | 4 | Compressed file size |
| 0x08 | uint32 | 4 | Uncompressed file size |
| 0x0C | uint32 | 4 | Flags (see below) |

#### Block Table Flags

| Flag | Hex | Description |
|------|-----|-------------|
| FILE_EXISTS | 0x80000000 | File exists (vs. deleted) |
| FILE_COMPRESSED | 0x00000200 | File is compressed (zlib sectors) |
| FILE_IMPLODE | 0x00000100 | File is imploded (PKWARE DCL) |
| FILE_ENCRYPTED | 0x00010000 | File is encrypted |
| FILE_FIX_KEY | 0x00020000 | Encryption key adjusted by file offset |
| FILE_SINGLE_UNIT | 0x04000000 | File is stored as a single unit (no sectors) |
| DELETE_MARKER | 0x01000000 | File is a deletion marker |

### 3.4 Sector-Based Compression

Files larger than one sector (4,096 bytes) are split into sectors. Compressed files contain a **Sector Offset Table (SOT)** at the beginning of their data region:

```
┌─────────────────────────────────────┐
│ Sector Offset Table                 │
│  uint32[N+1] offsets                │
│  (N = ceil(fileSize / sectorSize))  │
├─────────────────────────────────────┤
│ Sector 0 (compressed)               │
├─────────────────────────────────────┤
│ Sector 1 (compressed)               │
├─────────────────────────────────────┤
│ ...                                 │
└─────────────────────────────────────┘
```

Each sector is independently compressed. The first byte of each compressed sector indicates the compression method: `0x02` = zlib (RFC 1950/1951). If a sector's compressed size equals its expected uncompressed size, it is stored uncompressed.

### 3.5 MPQ Hash Algorithm

The MPQ uses a custom hash function based on a 1,280-entry lookup table (CRYPT_TABLE). Three hash types are used:

| Hash Type | Purpose |
|-----------|---------|
| 0 | Table index (starting slot for lookup) |
| 1 | Name hash A (verification) |
| 2 | Name hash B (verification) |
| 3 | Encryption key derivation |

The CRYPT_TABLE is generated deterministically from the seed `0x00100001` using the recurrence `seed = (seed × 125 + 3) mod 0x2AAAAB`. Filenames are uppercased and backslash-normalized before hashing.

---

## 4. Contained Files

The archive contains **16 files** (15 map data files + 1 listfile):

| # | Filename | Block | Compressed | Uncompressed | Flags | Description |
|---|----------|-------|-----------|--------------|-------|-------------|
| 0 | `war3map.w3e` | 0 | 7,307 | 29,644 | COMP | Terrain environment |
| 1 | `war3map.w3i` | 1 | 127 | 255 | COMP | Map information |
| 2 | `war3map.wtg` | 2 | 264 | 528 | COMP | Trigger definitions |
| 3 | `war3map.wct` | 3 | 181 | 280 | COMP | Custom text triggers |
| 4 | `war3map.wts` | 4 | 161 | 245 | COMP | String table |
| 5 | `war3map.j` | 5 | 1,402 | 5,844 | COMP | JASS script |
| 6 | `war3map.shd` | 6 | 500 | 65,536 | COMP | Shadow map |
| 7 | `war3mapMap.blp` | 7 | 16,105 | 16,733 | COMP | Minimap texture |
| 8 | `war3map.mmp` | 8 | 32 | 24 | COMP | Minimap icons |
| 9 | `war3map.wpm` | 9 | 1,216 | 65,552 | COMP | Pathing map |
| 10 | `war3map.doo` | 10 | 2,810 | 9,074 | COMP | Doodads (terrain objects) |
| 11 | `war3mapUnits.doo` | 11 | 107 | 238 | COMP | Placed units |
| 12 | `war3map.w3r` | 12 | 16 | 8 | COMP | Regions |
| 13 | `war3map.w3c` | 13 | 166 | 198 | COMP | Camera setups |
| 14 | `war3mapExtra.txt` | 14 | 39 | 31 | COMP | Extra settings |
| 15 | `(listfile)` | 15 | 100 | 206 | COMP+ENC | File listing (encrypted) |

**Total uncompressed:** ~193 KB | **Archive size:** ~31 KB | **Compression ratio:** ~6:1

---

## 5. Internal File Format Details

### 5.1 `war3map.w3e` — Terrain Environment

**Size:** 29,644 bytes
**Magic:** `"W3E!"`

This file defines the terrain heightmap, tile textures, cliff levels, and water data for every point on the map grid.

#### Header

| Offset | Type | Size | Value | Description |
|--------|------|------|-------|-------------|
| 0x00 | char[4] | 4 | `"W3E!"` | Magic signature |
| 0x04 | uint32 | 4 | 11 | Format version |
| 0x08 | char | 1 | `'L'` | Main tileset ID (`L` = Lordaeron Summer) |
| 0x09 | uint32 | 4 | 0 | Custom tileset flag (0 = use default) |
| 0x0D | uint32 | 4 | 6 | Number of ground tilesets |
| 0x11 | char[4][] | 24 | see below | Ground tileset IDs (4 chars each) |
| 0x29 | uint32 | 4 | 2 | Number of cliff tilesets |
| 0x2D | char[4][] | 8 | see below | Cliff tileset IDs |
| 0x35 | uint32 | 4 | 65 | Map width in tile points |
| 0x39 | uint32 | 4 | 65 | Map height in tile points |
| 0x3D | float32 | 4 | -4096.0 | Center offset X |
| 0x41 | float32 | 4 | -4096.0 | Center offset Y |

**Ground Tilesets:** `Ldrt` (Dirt), `Ldro` (Dark Rough), `Ldrg` (Grassy Dirt), `Lrok` (Rock), `Lgrs` (Grass), `Lgrd` (Dark Grass)

**Cliff Tilesets:** `CLdi` (Dirt Cliff), `CLgr` (Grass Cliff)

#### Tile Point Data

After the header, the file contains `width × height` = 65 × 65 = **4,225 tile points**, each 7 bytes:

| Offset | Type | Size | Description |
|--------|------|------|-------------|
| 0x00 | uint16 | 2 | Ground height (raw value; actual height = `(value - 0x2000) / 4.0 + centerZ`) |
| 0x02 | uint16 | 2 | Water level + flags in upper bits |
| 0x04 | uint8 | 1 | Bits 0–3: ground texture type index; Bits 4–7: flags (boundary, ramp, blight, water, camera) |
| 0x05 | uint8 | 1 | Ground texture detail / variation |
| 0x06 | uint8 | 1 | Cliff texture type + cliff level (bits 0–3: level, bits 4–7: cliff type) |

**Note:** The map grid is (`width-1`) × (`height-1`) = 64 × 64 tiles. Tile points are the corners of tiles, so there is one extra row and column. The playable area (52×52) is smaller than the full grid, with margins for camera bounds.

---

### 5.2 `war3map.w3i` — Map Information

**Size:** 255 bytes
**Format Version:** 25 (TFT)

This file contains all map metadata configured in the World Editor's "Scenario Properties" dialog.

| Offset | Type | Description | Value |
|--------|------|-------------|-------|
| 0x00 | uint32 | Format version | 25 (18 = RoC, 25 = TFT, 28 = Reforged) |
| 0x04 | uint32 | Number of saves | 4 |
| 0x08 | uint32 | Editor version | 6052 |
| 0x0C | string | Map name | `"TRIGSTR_003"` → resolves to `"Еще одна карта"` |
| var | string | Map author | `"TRIGSTR_006"` → resolves to `"Неизвестно"` (Unknown) |
| var | string | Map description | `"TRIGSTR_005"` → resolves to `"Описание отсутствует"` (No description) |
| var | string | Suggested players | `"TRIGSTR_004"` → resolves to `"Не важно"` (Doesn't matter) |
| var | float32[8] | Camera bounds | 8 floats defining the scrollable camera rectangle |
| var | uint32[4] | Camera bounds complements | (6, 6, 4, 8) — margin tiles on each side |
| var | uint32 | Playable width | 52 |
| var | uint32 | Playable height | 52 |
| var | uint32 | Flags | 0x0000DC10 (same as HM3W header) |
| var | char | Tileset | `'L'` (Lordaeron Summer) |
| var | uint32 | Campaign loading screen index | 0xFFFFFFFF (-1 = none) |
| var | string | Loading screen model path | `""` (empty) |
| var | string | Loading screen text | `""` |
| var | string | Loading screen title | `""` |
| var | string | Loading screen subtitle | `""` |
| var | ... | Fog, weather, sound, water, player/force data | See below |

#### Extended Fields (after loading screen)

| Field | Type | Description |
|-------|------|-------------|
| Fog type | uint32 | 0 = no fog, 1 = linear, 2 = exponential |
| Fog Z start | float32 | Fog start height |
| Fog Z end | float32 | Fog end height |
| Fog density | float32 | Fog density (0.0–1.0) |
| Fog color | uint8[4] | RGBA fog color |
| Global weather | uint32 | Weather effect ID (FourCC, 0 = none) |
| Sound environment | string | Sound environment preset name |
| Light tileset | char | Tileset used for lighting model |
| Water tint | uint8[4] | RGBA water color tint |
| Num players | uint32 | Number of player slots |
| Player entries | var | Per-player: number, type, race, fixed start, name, start pos, ally flags |
| Num forces | uint32 | Number of forces (teams) |
| Force entries | var | Per-force: flags, player mask, name |

**`TRIGSTR_NNN` references** are resolved at runtime using the string table (`war3map.wts`).

---

### 5.3 `war3map.wts` — String Table

**Size:** 245 bytes
**Format:** Plain text (UTF-8 with BOM)

The string table stores localized/translatable strings referenced throughout the map as `TRIGSTR_NNN`. Format is a sequence of blocks:

```
STRING <number>
{
<text content>
}
```

**Contents of this file:**

| Key | Value |
|-----|-------|
| STRING 1 | `"Игрок 1"` (Player 1) |
| STRING 2 | `"Клан 1"` (Clan 1) |
| STRING 3 | `"Еще одна карта"` (Yet another map) |
| STRING 4 | `"Не важно"` (Doesn't matter) |
| STRING 5 | `"Описание отсутствует"` (No description) |
| STRING 6 | `"Неизвестно"` (Unknown) |

---

### 5.4 `war3map.wtg` — Trigger Definitions

**Size:** 528 bytes
**Magic:** `"WTG!"`

Defines the trigger logic created in the World Editor's trigger editor (GUI triggers).

| Offset | Type | Description | Value |
|--------|------|-------------|-------|
| 0x00 | char[4] | Magic | `"WTG!"` |
| 0x04 | uint32 | Format version | 7 |
| 0x08 | uint32 | Number of categories | 1 |
| var | ... | Category entries | See below |
| var | uint32 | Number of triggers | 2 |
| var | ... | Trigger entries | See below |

#### Category Entry

| Type | Description |
|------|-------------|
| uint32 | Category ID |
| string | Category name (null-terminated) |
| uint32 | Is comment (0 = no, 1 = yes) |

**Category:** `"Инициализация"` (Initialization), ID = 0

#### Trigger Entry

| Type | Description |
|------|-------------|
| string | Trigger name |
| string | Trigger description |
| uint32 | Is comment |
| uint32 | Is enabled |
| uint32 | Is custom text |
| uint32 | Is initially on |
| uint32 | Run on map initialization |
| uint32 | Category ID |
| uint32 | Number of ECAs (Events/Conditions/Actions) |
| ... | ECA entries (recursive tree structure) |

Each ECA entry contains: type (0=event, 1=condition, 2=action), function name, enabled flag, and parameters. ECAs can nest (e.g., if/then/else blocks contain child ECAs).

---

### 5.5 `war3map.wct` — Custom Text Triggers

**Size:** 280 bytes

Contains custom JASS code entered directly in the trigger editor.

| Offset | Type | Description | Value |
|--------|------|-------------|-------|
| 0x00 | uint32 | Version | 1 |
| 0x04 | string | Global custom script comment | (Russian instruction text) |
| var | uint32 | Number of trigger custom scripts | 0 |

---

### 5.6 `war3map.j` — JASS Script

**Size:** 5,844 bytes
**Format:** Plain text (JASS source code)

The compiled JASS (Just Another Scripting Syntax) script that the game engine executes. Generated by the World Editor from GUI triggers and custom code.

Contains 120 lines including:

- **Globals:** `gg_trg_*` trigger variables, `gg_cam_*` camera setup references
- **Unit creation:** `CreateUnit(player, unitTypeId, x, y, facing)`
- **Camera initialization:** 4 camera setups (TransLocation, Lake, Deph, Crane)
- **Trigger setup:** Map initialization, melee configuration

**Unit type placed:** `0x48626C6D` = `"Hblm"` = Blood Mage (Human hero)

---

### 5.7 `war3map.doo` — Doodads (Terrain Objects)

**Size:** 9,074 bytes
**Magic:** `"W3do"`

Doodads are decorative terrain objects (trees, rocks, bushes, etc.).

#### Header

| Offset | Type | Size | Value | Description |
|--------|------|------|-------|-------------|
| 0x00 | char[4] | 4 | `"W3do"` | Magic signature |
| 0x04 | uint32 | 4 | 8 | Format version |
| 0x08 | uint32 | 4 | 11 | Sub-version (TFT) |
| 0x0C | uint32 | 4 | 181 | Number of doodads |

#### Doodad Entry (variable size, version 8)

| Offset | Type | Size | Description |
|--------|------|------|-------------|
| 0x00 | char[4] | 4 | Doodad type ID (FourCC) |
| 0x04 | uint32 | 4 | Variation index |
| 0x08 | float32 | 4 | X position (world units) |
| 0x0C | float32 | 4 | Y position |
| 0x10 | float32 | 4 | Z position |
| 0x14 | float32 | 4 | Facing angle (radians) |
| 0x18 | float32 | 4 | Scale X |
| 0x1C | float32 | 4 | Scale Y |
| 0x20 | float32 | 4 | Scale Z |
| 0x24 | uint8 | 1 | Flags (0x02 = visible, 0x04 = solid) |
| 0x25 | uint8 | 1 | Life percentage (0–100) |
| 0x26 | int32 | 4 | Random item table pointer (-1 = none) |
| 0x2A | uint32 | 4 | Number of item sets dropped on death |
| var | ... | var | Item set data (per set: count + items) |
| var | uint32 | 4 | Creation number (unique doodad ID) |

**All 181 doodads** in this map are of type `"ATtr"` (Ashenvale Tree) with various positions and scale variations. Facing angle is consistently 4.71 radians (~270°).

#### Special Doodads Section (after all doodad entries)

| Type | Value | Description |
|------|-------|-------------|
| uint32 | 0 | Special doodad format version |
| uint32 | 0 | Number of special doodads (cliff/water doodads) |

---

### 5.8 `war3mapUnits.doo` — Placed Units

**Size:** 238 bytes
**Magic:** `"W3do"` (shares magic with doodads)

Pre-placed units and items on the map.

#### Header

| Field | Value |
|-------|-------|
| Magic | `"W3do"` |
| Version | 8 |
| Sub-version | 11 |
| Number of units | 2 |

#### Unit Entry (variable size)

| Offset | Type | Size | Description |
|--------|------|------|-------------|
| 0x00 | char[4] | 4 | Unit type ID (FourCC) |
| 0x04 | uint32 | 4 | Variation |
| 0x08 | float32[3] | 12 | Position (X, Y, Z) |
| 0x14 | float32 | 4 | Facing angle (radians) |
| 0x18 | float32[3] | 12 | Scale (X, Y, Z) |
| 0x24 | uint8 | 1 | Flags |
| 0x25 | uint32 | 4 | Player/owner number |
| 0x29 | uint16 | 2 | Unknown |
| 0x2B | uint32 | 4 | Hit points (-1 = default %) |
| 0x2F | uint32 | 4 | Mana points (-1 = default %) |
| var | uint32 | 4 | Number of item sets dropped on death |
| var | ... | var | Item sets, abilities, random data... |
| var | uint32 | 4 | Gold amount |
| var | float32 | 4 | Target acquisition range |
| var | uint32 | 4 | Hero level |
| var | ... | var | Hero inventory, abilities, custom color... |
| var | uint32 | 4 | Creation number |

**Placed Units:**

| # | Type | Unit Name | Position | Owner |
|---|------|-----------|----------|-------|
| 0 | `Hblm` | Blood Mage | (-58.2, -140.2, 0.0) | Player 0 |
| 1 | `Hblm` | Blood Mage | (-58.2, -140.2, 0.0) | Player 0 |

---

### 5.9 `war3map.shd` — Shadow Map

**Size:** 65,536 bytes
**Format:** Raw byte array (no header)

A 256×256 grid of shadow cells (4 shadow cells per terrain tile, for a 64×64 tile map). Each byte represents shadow intensity at that cell:

| Value | Meaning |
|-------|---------|
| 0x00 | No shadow (fully lit) |
| 0xFF | Full shadow |

This map has all zeros — no pre-baked shadows.

**Dimensions formula:** `(mapWidth - 1) × 4` × `(mapHeight - 1) × 4` = 256 × 256 = 65,536 bytes.

---

### 5.10 `war3map.wpm` — Pathing Map

**Size:** 65,552 bytes
**Magic:** `"MP3W"`

Defines which cells on the map are walkable, flyable, and buildable.

#### Header

| Offset | Type | Size | Value | Description |
|--------|------|------|-------|-------------|
| 0x00 | char[4] | 4 | `"MP3W"` | Magic signature |
| 0x04 | uint32 | 4 | 0 | Format version |
| 0x08 | uint32 | 4 | 256 | Width in cells |
| 0x0C | uint32 | 4 | 256 | Height in cells |

#### Pathing Data

After the 16-byte header: `256 × 256 = 65,536 bytes`, one byte per cell.

**Pathing Flag Bits:**

| Bit | Hex | Description |
|-----|-----|-------------|
| 0 | 0x01 | Unwalkable |
| 1 | 0x02 | Unflyable |
| 2 | 0x04 | Unbuildable |
| 3 | 0x08 | Unknown (possibly unused) |
| 4 | 0x10 | Blight |
| 5 | 0x20 | Water |
| 6 | 0x40 | Unknown |
| 7 | 0x80 | Unknown |

**Pathing Distribution in this map:**

| Value | Flags | Count | % |
|-------|-------|-------|---|
| 0x08 | Flag 0x08 only | 1,920 | 2.9% |
| 0x0A | Unflyable + 0x08 | 1,040 | 1.6% |
| 0x40 | Flag 0x40 only | 35,360 | 54.0% |
| 0xCA | Unflyable + 0x08 + 0x40 + 0x80 | 4,944 | 7.5% |
| 0xCE | Unflyable + Unbuildable + 0x08 + 0x40 + 0x80 | 22,272 | 34.0% |

---

### 5.11 `war3mapMap.blp` — Minimap Texture

**Size:** 16,733 bytes
**Magic:** `"BLP1"`

The pre-rendered minimap image in BLP (Blizzard Picture) format.

| Offset | Type | Value | Description |
|--------|------|-------|-------------|
| 0x00 | char[4] | `"BLP1"` | Magic |
| 0x04 | uint32 | 0 | Content type (0 = JPEG, 1 = Palettized) |
| 0x08 | uint8 | 0 | Alpha bit depth |
| 0x0C | uint32 | 256 | Width |
| 0x10 | uint32 | 256 | Height |
| 0x14 | uint32 | 5 | Picture type / flags |
| 0x18 | uint32 | 0 | Has alpha channel (0 = no) |
| 0x1C | uint32[16] | ... | Mipmap offsets |
| 0x5C | uint32[16] | ... | Mipmap sizes |

**Image:** 256×256 JPEG-compressed minimap with no alpha. JPEG data follows the BLP header, referenced by mipmap offset 0.

---

### 5.12 `war3map.mmp` — Minimap Icons

**Size:** 24 bytes

Minimap icon markers (start locations, creep camps, etc.).

| Offset | Type | Value | Description |
|--------|------|-------|-------------|
| 0x00 | uint32 | 0 | Format version |
| 0x04 | uint32 | 1 | Number of icons |

Each icon entry (if present):

| Type | Size | Description |
|------|------|-------------|
| uint32 | 4 | Icon type (0=gold mine, 1=neutral building, 2=start location) |
| uint32 | 4 | X coordinate (minimap space) |
| uint32 | 4 | Y coordinate (minimap space) |
| uint8[4] | 4 | Color (BGRA) |

---

### 5.13 `war3map.w3c` — Camera Setups

**Size:** 198 bytes

Pre-defined camera configurations accessible by triggers.

| Offset | Type | Value | Description |
|--------|------|-------|-------------|
| 0x00 | uint32 | 0 | Format version |
| 0x04 | uint32 | 4 | Number of camera setups |

#### Camera Entry

| Offset | Type | Size | Description |
|--------|------|------|-------------|
| 0x00 | float32 | 4 | Target X |
| 0x04 | float32 | 4 | Target Y |
| 0x08 | float32 | 4 | Z offset |
| 0x0C | float32 | 4 | Rotation (degrees) |
| 0x10 | float32 | 4 | Angle of attack (degrees) |
| 0x14 | float32 | 4 | Distance to target |
| 0x18 | float32 | 4 | Roll |
| 0x1C | float32 | 4 | Field of view (degrees) |
| 0x20 | float32 | 4 | Far clipping plane Z |
| 0x24 | float32 | 4 | Unknown |
| 0x28 | string | var | Camera name (null-terminated) |

**Camera Setups:**

| # | Name | Target | Rotation | AoA | Distance | FOV | Far Z |
|---|------|--------|----------|-----|----------|-----|-------|
| 0 | TransLocation | (2623.4, -526.0) | 87.3° | 333.8° | 1650.0 | 70.0° | 5000.0 |
| 1 | Lake | (-200.7, 1500.3) | 58.4° | 330.5° | 1650.0 | 70.0° | 5000.0 |
| 2 | Deph | (-1509.9, -590.7) | 68.1° | 328.9° | 6265.9 | 20.0° | 7320.5 |
| 3 | Crane | (parse incomplete) | — | — | — | — | — |

---

### 5.14 `war3map.w3r` — Regions

**Size:** 8 bytes

Rectangular regions defined in the World Editor for trigger use.

| Offset | Type | Value | Description |
|--------|------|-------|-------------|
| 0x00 | uint32 | 5 | Format version |
| 0x04 | uint32 | 0 | Number of regions |

No regions are defined in this map.

#### Region Entry (if present)

| Type | Size | Description |
|------|------|-------------|
| float32 | 4 | Left bound |
| float32 | 4 | Bottom bound |
| float32 | 4 | Right bound |
| float32 | 4 | Top bound |
| string | var | Region name |
| uint32 | 4 | Region ID |
| uint32 | 4 | Weather effect ID |
| string | var | Ambient sound |
| uint8[3] | 3 | Region color (RGB) |
| uint8 | 1 | End byte |

---

### 5.15 `war3mapExtra.txt` — Extra Settings

**Size:** 31 bytes
**Format:** INI-style plain text

```ini
[MapExtraInfo]
TimeOfDay=1
```

Contains additional map configuration not covered by other files. `TimeOfDay=1` sets the starting time of day.

---

## 6. File Relationships

```
┌─────────────────────────────────────────────────────┐
│                   war3map.w3i                       │
│              (Map metadata, players)                │
│         References TRIGSTR_NNN strings               │
│                      │                              │
│              ┌───────┴───────┐                      │
│              ▼               ▼                      │
│        war3map.wts      war3map.j                   │
│     (String table)    (JASS script)                 │
│                         ▲                           │
│                         │ generated from            │
│                   ┌─────┴─────┐                     │
│                   │           │                     │
│             war3map.wtg  war3map.wct                │
│          (GUI triggers) (Custom code)               │
│                                                     │
│  ┌──────────────┬──────────────┬──────────────┐    │
│  │ war3map.w3e  │ war3map.doo  │ Units.doo    │    │
│  │  (Terrain)   │  (Doodads)   │ (Units)      │    │
│  └──────┬───────┴──────────────┴──────────────┘    │
│         │ derived from terrain                      │
│  ┌──────┴───────┬──────────────┬──────────────┐    │
│  │ war3map.shd  │ war3map.wpm  │ war3mapMap   │    │
│  │  (Shadows)   │  (Pathing)   │   .blp       │    │
│  │  256×256     │  256×256     │ (Minimap)    │    │
│  └──────────────┴──────────────┴──────────────┘    │
│                                                     │
│  war3map.w3r (Regions)  war3map.w3c (Cameras)      │
│  war3map.mmp (Icons)    war3mapExtra.txt (Settings) │
└─────────────────────────────────────────────────────┘
```

---

## 7. Additional Files (not present in this map)

W3X archives may also contain these files, which are absent from this particular map:

| Filename | Description |
|----------|-------------|
| `war3map.w3u` | Custom unit data |
| `war3map.w3t` | Custom item data |
| `war3map.w3a` | Custom ability data |
| `war3map.w3b` | Custom destructable data |
| `war3map.w3d` | Custom doodad data |
| `war3map.w3q` | Custom upgrade data |
| `war3map.w3h` | Custom buff data |
| `war3map.imp` | Imported file list |
| `war3mapSkin.txt` | UI skin overrides |
| `war3mapMisc.txt` | Gameplay constants |
| `war3mapPreview.tga` | Preview image (TGA) |
| `war3map.lua` | Lua script (Reforged) |
| `war3mapPreview.blp` | Preview image (BLP) |

---

## 8. Size Distribution

| Component | Size (bytes) | % of Total |
|-----------|-------------|------------|
| HM3W Header | 512 | 1.6% |
| MPQ Header + Tables | ~1,312 | 4.1% |
| war3map.shd (compressed) | 500 | 1.5% |
| war3mapMap.blp (compressed) | 16,105 | 49.8% |
| war3map.w3e (compressed) | 7,307 | 22.6% |
| war3map.doo (compressed) | 2,810 | 8.7% |
| war3map.j (compressed) | 1,402 | 4.3% |
| war3map.wpm (compressed) | 1,216 | 3.8% |
| All other files | ~1,193 | 3.6% |
| **Total** | **32,357** | **100%** |

The minimap texture alone accounts for nearly half of the compressed archive size.

---

*Documentation generated from binary analysis of `claude_map.w3x` (32,357 bytes, HM3W + MPQ v1, Warcraft III: The Frozen Throne format).*
