export interface ChipProps {
  label: string;
  selected?: boolean;
}
export function Chip({ label, selected = false }: ChipProps) {
  return <span aria-pressed={selected}>{label}</span>;
}
