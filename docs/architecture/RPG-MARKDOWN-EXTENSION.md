# RPG Markdown (RPGMD) Specification

**Version:** 1.0  
**Status:** Draft  
**Target Platforms:** Tauri Desktop, Web Application  
**Purpose:** Structured content format for AI storytelling, DM handouts, journals, chat rendering, language presentation, and future Polyglot support.

---

# 1. Overview

RPG Markdown (RPGMD) extends standard Markdown with RPG-specific semantic directives.

The primary goal is to separate **content**, **presentation**, and **comprehension** into distinct layers.

RPGMD content should describe:

- What something is
- Who is speaking
- What language is being used
- Whether content is narration, dialogue, notes, lore, or handouts

RPGMD should never define:

- Font families
- Colours
- CSS classes
- Visual styling

These are renderer responsibilities.

---

# 2. Design Principles

## 2.1 Semantic First

Store meaning rather than presentation.

### Good

    :::speech speaker="Kestrel" language="common"
    This place feels wrong.
    :::

### Bad

    <span class="elvish-font green-text">
      This place feels wrong.
    </span>

---

## 2.2 Presentation Independence

The same content should be capable of rendering as chat messages, journal entries, PDF exports, mobile layouts, and AI-generated storybooks.

---

## 2.3 Polyglot Ready

Language identity must be independent of language comprehension.

---

## 2.4 Accessibility First

All content must remain usable when custom language fonts are disabled, dyslexia-friendly mode is enabled, screen readers are active, or high contrast mode is enabled.

---

# 3. Document Structure

An RPGMD document consists of:

1. Optional metadata header
2. Standard Markdown
3. RPG directives
4. Inline RPG references

---

# 4. Metadata Header

Supports YAML frontmatter.

    ---
    title: Session 14 Summary
    campaign: Wrackwater Reach
    session: 14
    ---

---

# 5. Directive Syntax

    :::directive-name attribute="value"
    Content
    :::

---

# 6. Core Narrative Directives

## Narration

    :::narration
    Dark clouds rolled across Wrackwater Reach.
    :::

## Speech

    :::speech speaker="Ghorrim" language="dwarvish"
    Khazad ul barak.
    :::

## Action

    :::action speaker="Ghorrim"
    folds the letter carefully.
    :::

## Thought

    :::thought speaker="Kestrel"
    Something is wrong here.
    :::

## Whisper

    :::whisper speaker="Kestrel" target="Ghorrim"
    Meet me outside after sunset.
    :::

## OOC

    :::ooc
    Does Channel Divinity refresh on a short rest?
    :::

## System

    :::system
    Quest Updated: The Bell Beneath the Waves
    :::

---

# 7. Handout Directives

## Letter

    :::letter title="Letter from Mother Tidewarden"
    To Ghorrim Duskhammer,
    :::

## Journal

    :::journal author="Aelwen"
    Today we arrived at Wrackwater Reach.
    :::

## Book

    :::book title="Treatise on Dragons"
    The oldest dragons remember...
    :::

## Scroll

    :::scroll
    Arcane symbols dance across the parchment.
    :::

## Inscription

    :::inscription language="dwarvish"
    Khazad ul durin.
    :::

## Quest

    :::quest title="The Bell Beneath the Waves"
    Investigate the drowned bell tower.
    :::

---

# 8. Language System

| Language      | Family    |
| ------------- | --------- |
| Common        | Civilized |
| Dwarvish      | Civilized |
| Elvish        | Civilized |
| Gnomish       | Civilized |
| Halfling      | Civilized |
| Goblin        | Harsh     |
| Orc           | Harsh     |
| Giant         | Ancient   |
| Draconic      | Ancient   |
| Celestial     | Ancient   |
| Primordial    | Natural   |
| Sylvan        | Natural   |
| Druidic       | Natural   |
| Infernal      | Dark      |
| Abyssal       | Dark      |
| Deep Speech   | Dark      |
| Undercommon   | Dark      |
| Thieves' Cant | Hidden    |

---

# 9. Typography Mapping

| Language      | Font               |
| ------------- | ------------------ |
| Common        | Inter              |
| Dwarvish      | Alegreya SC        |
| Elvish        | Cormorant Garamond |
| Giant         | Uncial Antiqua     |
| Gnomish       | Marcellus          |
| Goblin        | IM Fell English    |
| Halfling      | Quattrocento       |
| Orc           | Alegreya Sans SC   |
| Draconic      | Forum              |
| Celestial     | Cinzel Decorative  |
| Infernal      | IM Fell DW Pica    |
| Abyssal       | Black Ops One      |
| Deep Speech   | Metamorphous       |
| Primordial    | Julius Sans One    |
| Sylvan        | Philosopher        |
| Undercommon   | Rosarivo           |
| Druidic       | Caudex             |
| Thieves' Cant | Inter (Styled)     |

---

# 10. Polyglot System

Language appearance and language understanding are separate concerns.

Comprehension levels:

- Unknown
- Recognition
- Partial
- Conversational
- Fluent

---

# 11. Inline References

    @Ghorrim
    #WrackwaterReach
    $item:VorpalSword
    $spell:Fireball
    $monster:YoungRedDragon
    $condition:Poisoned

---

# 12. Dice Expressions

    [[1d20]]
    [[1d20+5]]
    [[8d6]]
    [[!1d20+7]]

---

# 13. Accessibility Requirements

- Enable Language Fonts
- Force Readable Mode
- Dyslexia-Friendly Mode
- High Contrast Mode
- Screen Reader Mode

---

# 14. Renderer Requirements

A compliant renderer MUST:

- Support CommonMark Markdown
- Support RPGMD directives
- Support language metadata
- Support Polyglot transformations
- Preserve semantic meaning
- Remain accessible

---

# 15. Reserved Directives

    :::map
    :::encounter
    :::combat
    :::npc
    :::faction
    :::timeline
    :::weather
    :::scene
    :::music
    :::sound
    :::cinematic

---

# 16. Example Complete Document

    ---
    title: Letter from Mother Tidewarden
    campaign: Wrackwater Reach
    ---

    :::letter title="Letter from Mother Tidewarden"
    To Ghorrim Duskhammer,

    The bell of Skelling rings once more beneath the waves.
    :::

    :::speech speaker="Kestrel" language="common"
    How much is she paying?
    :::
