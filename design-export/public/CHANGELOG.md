# Aivora Platform — Changelog

## Version 2.0 — 2026-05-19

### HOW TO USE EACH FEATURE:

---

### QC Workstation
**Steps:** Upload WAV → Auto-analysis → Read metrics
**Metrics:** LUFS / SNR / True Peak / RT60 / DNSMOS / Noise Class / Export Safe
**New:** Noise Intelligence panel + DNSMOS score + Export validation

---

### Forensic Silence Repair
**Steps:** Upload WAV → Select Quality Tier → Click Repair → Download
**Quality Tiers:**
- Broadcast: strictest (TTS/broadcast delivery)
- Dataset: standard (ASR/annotation projects)
- General: relaxed (podcasts/demos)
**New:** Quality Tier System + Noise Intelligence + RT60

---

### Enhancement Lab
**Steps:** Upload WAV → Toggle processors → Click Run Enhancement → Download
**Processors:** Spectral Denoise / Multi-band Comp / De-click / HP Filter / LP Filter / Noise Gate / Silence Trim / LUFS Normalize
**New:** Spectral Denoise + Multi-band Compression sections

---

### Pro Editor
**Steps:** Upload WAV → View waveform + spectrogram → Use toolbar → Export
**New:** Timeline Engine (non-destructive) + DNSMOS badges + Noise Intelligence

---

### Audio Pipeline
**Steps:** Upload WAV → Select profile → Process → Download
**Profiles:** TTS Training / ASR Training / Broadcast / Podcast / Forensic / General
**New:** Connected to Unified DSP Controller (6 presets)

---

### Delivery Readiness
**Steps:** Drag WAV files → View 10-check report → Fix issues → Re-validate
**Checks:** True Peak / LUFS / Clipping / Digital Mute / Seam Risk / Duration Drift / Sample Rate / Speech Preservation
**New:** Real validator + Supabase logging

---

### Audio Bench
**Steps:** Select task → Upload WAV → View score + grade → Export JSONL
**Tasks:** ABT-001 to ABT-009 (Easy to Expert)
**New:** Results saved to Supabase bench_results

---

### Conversation Rooms
**Steps:** Upload Speaker A WAV → Upload Speaker B WAV → Set options → Mix & Master → Download
**Options:** Stereo Width / Target LUFS / Crossfade / Export Format (Stereo/Mono)
**New:** True sequential interleaving algorithm + smart ducking

---

### Smart Naming
**Steps:** Upload WAV files OR paste Google Drive link → Set speaker ID + locale → Export ZIP
**Formats:** S0001.wav → S0200.wav (sequential)
**New:** Google Drive link import

---

### File Manager
**Steps:** Upload WAV files → Use Quick Actions (TTS/ASR/Podcast/Broadcast) → Download processed
**New:** Connected to Unified DSP Controller

---

### Activity Monitor
**Steps:** Open → View all processed jobs → Filter by status → Refresh
**New:** Owner sees all jobs + realtime updates

---

### Contributors
**Steps:** Open → View team members → Change roles (owner only)
**New:** Real Supabase profiles + role management

---

### Documentation
**Steps:** Open → Search or browse → Read guides
**New:** Tutorial-style how-to guides + auto-update from CHANGELOG
