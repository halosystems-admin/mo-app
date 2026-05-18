/** Open patient folders workspace, then run clinical Type / Dictate (same events as mobile bar). */
export function dispatchClinicalConsultationEvent(mode: 'type' | 'dictate'): void {
  const name = mode === 'type' ? 'halo:start-type-note' : 'halo:toggle-consultation-dictation';
  window.dispatchEvent(new Event(name));
}

export function openPatientThenClinicalConsultation(
  patientId: string,
  mode: 'type' | 'dictate',
  openPatientWorkspace: (id: string) => void
): void {
  openPatientWorkspace(patientId);
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => dispatchClinicalConsultationEvent(mode));
  });
}
