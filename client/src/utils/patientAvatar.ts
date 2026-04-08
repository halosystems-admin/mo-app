/** Clean single border when selected — no ring-offset “double circle” gaps. */
const AVATAR_BASE =
  'bg-white text-[#4FB6B2] border border-[#E5E7EB] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.05)]';

export function patientAvatarClassWithSelection(_patientId: string, _name: string, selected: boolean): string {
  return selected
    ? `${AVATAR_BASE} bg-[#E6F4F3] border-[#4FB6B2] text-[#1F2937] border-2`
    : AVATAR_BASE;
}
