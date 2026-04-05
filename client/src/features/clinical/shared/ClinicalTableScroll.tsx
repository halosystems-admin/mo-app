import React from 'react';
import { CLINICAL_TABLE_CARD_OUTER, CLINICAL_TABLE_SCROLL_INNER } from './tableScrollClasses';

/** Rounds border on an outer shell; scrolls table inside so content is not clipped at edges. */
export const ClinicalTableScroll: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className={CLINICAL_TABLE_CARD_OUTER}>
    <div className={CLINICAL_TABLE_SCROLL_INNER} style={{ WebkitOverflowScrolling: 'touch' }}>
      {children}
    </div>
  </div>
);
