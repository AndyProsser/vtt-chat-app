import { Slider } from '@radix-ui/themes';
import type { LucideIcon } from 'lucide-react';

/** A small level slider at the right of a deck row: an icon, the slider, and nothing else, so it is quick to reach. */
export function MixSlider({
  label,
  icon: Icon,
  value,
  onChange,
}: {
  /** What it sets, for the tip and the screen reader ("Stinger volume"). */
  label: string;
  icon: LucideIcon;
  /** 0 to 1. */
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="vtt-deck-mix" title={`${label}: ${Math.round(value * 100)}%`}>
      <Icon size={13} aria-hidden />
      <Slider
        aria-label={label}
        size="1"
        min={0}
        max={100}
        value={[Math.round(value * 100)]}
        onValueChange={([v]) => onChange((v ?? 0) / 100)}
      />
    </label>
  );
}
