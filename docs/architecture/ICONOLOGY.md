# RPG Typography & Iconography Design Specification

**Version:** 1.0  
**Target Platforms:** Tauri Desktop, Web Application  
**Audience:** UI/UX Design, Front-End Development, Claude Code Implementation

---

## Overview

This document defines the visual language system used throughout the RPG application.

The objectives are to:

- Create a strong tabletop fantasy atmosphere.
- Improve visual recognition of in-world languages.
- Maintain usability during extended play sessions.
- Support future language comprehension mechanics.
- Establish a scalable iconography system suitable for hundreds of game concepts.

Rather than treating fonts as simple decoration, typography becomes part of the application's world-building and storytelling systems.

---

## Design Goals

## 1. Readability Where It Matters

Players may read tens of thousands of words over the course of a campaign.

Critical interfaces should always prioritise readability:

- Character sheets
- Chat panels
- Combat logs
- Notes and journals
- Rules references
- Forms and configuration screens

Decorative styling should enhance immersion without creating friction.

---

## 2. Language Recognition

Players should be able to immediately recognise:

- "This is Elvish."
- "This is Dwarvish."
- "This appears to be Celestial."

Language identity should remain visible regardless of whether the player understands the language.

---

## 3. Visual Hierarchy

Three typography layers exist within the application:

| Layer                | Purpose                            |
| -------------------- | ---------------------------------- |
| UI Typography        | Navigation, controls, menus, forms |
| Narrative Typography | Dialogue, handouts, journals       |
| Language Typography  | In-world language identity         |

---

## 4. Future Polyglot Support

The visual system must support future mechanics where characters may:

- Recognise a language
- Partially understand a language
- Fully understand a language
- Translate a language through magic or skill

Typography should remain consistent regardless of comprehension level.

---

## Iconography System

## Design Philosophy

The application will use a dual-layer icon system.

### Layer 1: UI Icons

**Library:** Lucide React

Used for:

- Navigation
- Menus
- Search
- Settings
- Chat controls
- General UI actions
- Application chrome

Lucide provides a clean, modern, and accessible user interface foundation.

---

### Layer 2: RPG Domain Icons

**Library:** Game Icons

Website:

https://game-icons.net/

Used for:

- Classes
- Spells
- Damage types
- Conditions
- Equipment
- Creatures
- Skills
- Factions
- Resources
- Crafting
- Quests

Game Icons contains thousands of fantasy-themed SVG icons which are significantly more expressive than traditional UI icon libraries.

---

## React Integration

Recommended workflow:

```text
Game Icons SVG
    ↓
SVGR Conversion
    ↓
React Components
    ↓
Shared Icon Package
```

Example:

```tsx
import FireballIcon from '@/icons/game/FireballIcon';
import DragonHeadIcon from '@/icons/game/DragonHeadIcon';
import SwordIcon from '@/icons/game/SwordIcon';
```

---

## Recommended RPG Icon Categories

### Combat

- Melee
- Ranged
- Initiative
- Defence
- Critical Hits

### Damage Types

- Fire
- Cold
- Lightning
- Acid
- Poison
- Psychic
- Force
- Radiant
- Necrotic
- Thunder

### Classes

- Fighter
- Rogue
- Wizard
- Ranger
- Cleric
- Paladin
- Bard
- Druid
- Monk
- Sorcerer
- Warlock
- Barbarian

### Conditions

- Blinded
- Charmed
- Deafened
- Grappled
- Restrained
- Incapacitated
- Invisible
- Petrified
- Poisoned
- Exhausted

### Exploration & Utility

- Dungeon
- Settlement
- Quest
- Merchant
- Travel
- Wilderness
- Camp
- Journal

---

## Core Typography

## Body Font

### Inter

**Google Fonts:**  
https://fonts.google.com/specimen/Inter

Used for:

- General UI
- Chat
- Forms
- Tooltips
- Rules references
- Character sheets

```css
font-family: 'Inter', sans-serif;
```

---

## Heading Font

### Cinzel

**Google Fonts:**  
https://fonts.google.com/specimen/Cinzel

Used for:

- Section headings
- Character names
- Quest names
- Dialog titles
- Navigation groups

```css
font-family: 'Cinzel', serif;
```

---

## Language Typography System

## Design Approach

Not every fantasy language should prioritise readability equally.

Real-world languages often carry strong visual identity independent of comprehension. The same principle should apply here.

Some languages intentionally optimise atmosphere over readability.

---

## Language Reference Table

| Language      | Font               | Google Fonts                                         | Theme                                     |
| ------------- | ------------------ | ---------------------------------------------------- | ----------------------------------------- |
| Common        | Inter              | https://fonts.google.com/specimen/Inter              | Neutral and readable                      |
| Dwarvish      | Alegreya SC        | https://fonts.google.com/specimen/Alegreya+SC        | Stonework, clans, craftsmanship           |
| Elvish        | Cormorant Garamond | https://fonts.google.com/specimen/Cormorant+Garamond | Graceful, poetic, ancient                 |
| Giant         | Uncial Antiqua     | https://fonts.google.com/specimen/Uncial+Antiqua     | Monumental and ancient                    |
| Gnomish       | Marcellus          | https://fonts.google.com/specimen/Marcellus          | Inventive and scholarly                   |
| Goblin        | IM Fell English    | https://fonts.google.com/specimen/IM+Fell+English    | Chaotic and improvised                    |
| Halfling      | Quattrocento       | https://fonts.google.com/specimen/Quattrocento       | Friendly and welcoming                    |
| Orc           | Alegreya Sans SC   | https://fonts.google.com/specimen/Alegreya+Sans+SC   | Harsh, direct, tribal                     |
| Draconic      | Forum              | https://fonts.google.com/specimen/Forum              | Ancient empire and mastery                |
| Celestial     | Cinzel Decorative  | (https://fonts.google.com/specimen/Cinzel+Decorative | Divine scripture                          |
| Infernal      | IM Fell DW Pica    | https://fonts.google.com/specimen/IM+Fell+DW+Pica    | Contracts and infernal law                |
| Abyssal       | Black Ops One      | https://fonts.google.com/specimen/Black+Ops+One      | Corruption and chaos                      |
| Deep Speech   | Metamorphous       | https://fonts.google.com/specimen/Metamorphous       | Alien and unknowable                      |
| Primordial    | Julius Sans One    | https://fonts.google.com/specimen/Julius+Sans+One    | Elemental power                           |
| Sylvan        | Philosopher        | https://fonts.google.com/specimen/Philosopher        | Fey and natural beauty                    |
| Undercommon   | Rosarivo           | https://fonts.google.com/specimen/Rosarivo           | Sophisticated subterranean culture        |
| Druidic       | Caudex             | https://fonts.google.com/specimen/Caudex             | Ancient natural traditions                |
| Thieves' Cant | Inter (Styled)     | https://fonts.google.com/specimen/Inter              | Hidden meaning rather than foreign speech |

---

## Language Families

Grouping languages creates recognisable visual patterns across the world.

## Civilized Languages

Languages of trade, learning, and established cultures.

### Members

- Common
- Dwarvish
- Elvish
- Gnomish
- Halfling

### Characteristics

- High readability
- Classical typography
- Comfortable for extended reading

---

## Harsh Languages

Languages of warriors, raiders, and aggressive cultures.

### Members

- Orc
- Goblin

### Characteristics

- Strong weight
- Dense forms
- Rough aesthetic

---

## Ancient Languages

Languages associated with great age and lost empires.

### Members

- Giant
- Draconic
- Celestial

### Characteristics

- Decorative capitals
- Increased letter spacing
- Monumental appearance

---

## Natural Languages

Languages connected to nature and the primal world.

### Members

- Sylvan
- Druidic
- Primordial

### Characteristics

- Organic forms
- Flowing rhythm
- Ancient but living

---

## Dark Languages

Languages that should feel unsettling and foreign.

### Members

- Infernal
- Abyssal
- Deep Speech
- Undercommon

### Characteristics

- Reduced readability
- Atmospheric presentation
- Distinctive visual identity

---

## Hidden Languages

### Members

- Thieves' Cant

### Characteristics

- Familiar appearance
- Meaning concealed
- Styling communicates secrecy

---

## Chat Presentation Rules

## In-Character Speech

Used for normal character dialogue.

```css
font-family: inherit;
```

Example:

> "The tide is turning."

---

## Character Actions

Used for emotes and descriptive actions.

```css
font-style: italic;
opacity: 0.92;
```

Example:

> _Ghorrim folds the letter carefully and places it inside his tabard._

---

## Out-of-Character Messages

Used for rules discussion and table conversation.

```css
opacity: 0.8;
font-size: 0.95em;
```

Example:

> OOC: Does Channel Divinity return on a short rest?

---

## DM Narration

Used for environmental descriptions and scene-setting.

```css
font-family: Inter;
font-weight: 500;
```

---

## Handouts, Letters & Journals

Used for:

- Letters
- Books
- Journals
- Historical records
- Read-aloud text

```css
font-family: 'Cormorant Garamond';
```

---

## Polyglot Language System

## Core Principle

**Separate Language Appearance from Language Comprehension.**

Most RPG systems convert unknown languages into gibberish and then replace them with plain text once understood.

This destroys language identity.

Instead:

- Font = what the language looks like
- Polyglot = how much the player understands

The visual identity should remain constant.

---

## Comprehension Levels

## Unknown

Player cannot recognise the language.

Example:

```text
[Unintelligible Dwarvish]
```

or

```text
⟪spoken Dwarvish⟫
```

---

## Recognition

Player recognises the language but cannot understand it.

Example:

```text
Khazad ul grum barak thorin.
```

Presented using the Dwarvish font.

---

## Partial Understanding

Player understands key words and phrases.

Example:

```text
Khazad ul [mountain] barak [gold].
```

Presented using the Dwarvish font.

---

## Conversational

Most text translated.

Rare words remain foreign.

Example:

```text
The mountain contains many kharadûn.
```

Presented using the Dwarvish font.

---

## Fluent

Complete translation.

Example:

```text
The mountain holds great reserves of gold.
```

Displayed using the Dwarvish font unless accessibility settings override language typography.

---

## Polyglot Flavour Profiles

The future Polyglot system should generate language-specific characteristics rather than random gibberish.

| Language    | Characteristics                                    |
| ----------- | -------------------------------------------------- |
| Dwarvish    | Dense consonants, compound words                   |
| Elvish      | Long vowels, flowing syllables                     |
| Gnomish     | Technical terminology, compound constructions      |
| Goblin      | Abbreviated words, clipped phrases                 |
| Orc         | Short forceful syllables                           |
| Draconic    | Formal grammar, ritual structure                   |
| Celestial   | Symmetry, elegance, consistency                    |
| Infernal    | Repetition, contractual language                   |
| Abyssal     | Corrupted words, instability                       |
| Deep Speech | Symbols, unusual punctuation, impossible structure |
| Primordial  | Elemental imagery                                  |
| Sylvan      | Musical cadence and natural metaphors              |
| Undercommon | Refined but distant vocabulary                     |

---

## Accessibility Requirements

All fantasy typography should be optional.

Provide user preferences for:

```text
☐ Enable language-specific fonts
☐ Enable decorative document fonts
☐ Enable Polyglot visual effects
☐ Force readable mode
```

When enabled, Force Readable Mode should:

- Replace language fonts with Inter.
- Preserve language metadata.
- Preserve colours and icons.
- Maintain full accessibility support.

---

## Recommended Font Package

```text
Inter
Cinzel
Cinzel Decorative
Alegreya SC
Alegreya Sans SC
Cormorant Garamond
Uncial Antiqua
Marcellus
IM Fell English
IM Fell DW Pica
Quattrocento
Forum
Metamorphous
Black Ops One
Julius Sans One
Philosopher
Rosarivo
Caudex
```

---

## Recommended Icon Package

```text
Lucide React
+
Game Icons
(SVG → SVGR → React Components)
```

This combination provides:

- Modern application usability
- Rich fantasy-specific iconography
- Strong language identity
- Future-ready Polyglot support
- Accessibility-friendly fallbacks
- A consistent visual language across desktop and web deployments
