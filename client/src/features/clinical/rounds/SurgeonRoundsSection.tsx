import type { ComponentProps, FC } from 'react';
import { InpatientsSection } from '../inpatients/InpatientsSection';

/**
 * Legacy export name: this is the same single “All patients” sheet (full inpatient grid).
 * Prefer importing `InpatientsSection` from `../inpatients/InpatientsSection`.
 */
export const SurgeonRoundsSection: FC<ComponentProps<typeof InpatientsSection>> = (props) => (
  <InpatientsSection {...props} />
);
