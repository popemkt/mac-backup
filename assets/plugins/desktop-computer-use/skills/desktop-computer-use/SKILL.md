---
name: desktop-computer-use
description: macOS computer-use routing and policy guide. Chooses Orca for fast interactive user tasks or CuaDriver for background stealth automation without hijacking mouse or focus.
---

# Desktop Computer Use on macOS

When operating macOS desktop applications and windows, choose between **Orca** and **CuaDriver** based on whether the task is interactive or running in the background.

## The Core Rule: Tool Selection

| Scenario | Tool to Use | Why | Action Required |
| :--- | :--- | :--- | :--- |
| **Interactive / Attended Tasks** *(Working with the human present)* | **Orca (`orca computer`)** | **Fastest turn latency (~0.5s)** and heavily pruned accessibility trees saving context tokens. | **MUST run `orca skills get computer-use` first** to read its version-matched guide. Follow its element indexing, Retina 2x coordinate scaling, and verification rules. |
| **Background / Non-Disruptive Tasks** *(Human working simultaneously)* | **CuaDriver (`cua-driver`)** | **True background stealth (SkyLight SPI)** without stealing window focus or hijacking the human's physical mouse pointer. | Always target elements by `element_token` / `element_index` + `snapshot_id` or `scope: "window"` using semantic AX actions (`set_value`, `click` with `AXPress`). |

---

## Load-Bearing Caveats

### 1. Cursor Hijacking vs. Synthetic Cursor Overlay
- **`scope: "window"` (Safe / Default)**: Interacts with the target window invisibly via background accessibility. Draws an animated synthetic cursor overlay to show where the AI acts, but **never moves the physical hardware mouse**.
- **`scope: "desktop"` (Danger)**: Translates coordinates into hardware `CGEvent` posts, which **physically warps and hijacks the human's mouse cursor**. Never use desktop scope for background tasks.

### 2. Orca Skills Discovery
- Do not guess `orca computer` flags or options. Always read the version-matched guide from the active binary:
  ```bash
  orca skills get computer-use
  ```

### 3. CuaDriver TCC Permissions & Daemons
- If `cua-driver` actions fail or time out, ensure permissions are granted:
  ```bash
  cua-driver permissions grant
  ```
  *(Requires Accessibility, Screen Recording, and direct-capture consent).*
- Live visual feedback: The optional floating Picture-in-Picture HUD is active when started with `--experimental-pip`.
