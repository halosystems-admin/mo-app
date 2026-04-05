import React, { useCallback, useEffect, useState } from 'react';
import type { ClinicalWard, SurgeonName, SurgeonRoundRow } from '../../../types/clinical';
import { fetchSurgeonRounds, getClinicalWards, type RoundFilters } from '../../../services/clinicalData';
import { MessageCircle, Phone } from 'lucide-react';
import { formatWardDisplay, wardBadgeClass } from '../shared/clinicalDisplay';
import { ClinicalTableScroll } from '../shared/ClinicalTableScroll';
import { CLINICAL_TABLE_TH, CLINICAL_TABLE_TBODY_TR, CLINICAL_TABLE_THEAD } from '../shared/tableScrollClasses';
import { SurgeonRoundDetailPanel } from '../shared/SurgeonRoundDetailPanel';

const SURGEONS: SurgeonName[] = ['Hoosain', 'Stanley', 'de Beer', 'Strydom'];

export const SurgeonRoundsSection: React.FC = () => {
  const [filters, setFilters] = useState<RoundFilters>({
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    surgeon: '',
    ward: '',
  });
  const [rows, setRows] = useState<SurgeonRoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailRow, setDetailRow] = useState<SurgeonRoundRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSurgeonRounds(filters);
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDetailRow(null);
  }, [filters.startDate, filters.endDate, filters.surgeon, filters.ward]);

  const wards = getClinicalWards();

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Filter surgeon rounds (mock). <strong className="text-slate-800">Click a row</strong> for the full plan and
        management detail.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-white rounded-xl border border-slate-200 p-4">
        <div>
          <label className="text-xs font-semibold text-slate-600">Start date</label>
          <input
            type="date"
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={filters.startDate || ''}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">End date</label>
          <input
            type="date"
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={filters.endDate || ''}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Surgeon</label>
          <select
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={filters.surgeon || ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, surgeon: e.target.value as SurgeonName | '' }))
            }
          >
            <option value="">All</option>
            {SURGEONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Ward</label>
          <select
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-sm"
            value={filters.ward || ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, ward: e.target.value as ClinicalWard | '' }))
            }
          >
            <option value="">All</option>
            {wards.map((w) => (
              <option key={w} value={w}>
                {formatWardDisplay(w)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ClinicalTableScroll>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : (
          <table className="min-w-[1200px] w-full text-sm">
            <thead className={CLINICAL_TABLE_THEAD}>
              <tr>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Ward</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Surname</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Name</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Diagnosis</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Bed</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>DOB</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Review</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Age</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Sex</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Aid</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Aid #</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Contact</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Surgeon</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Complications</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Surg plan</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Mgmt</th>
                <th className={`${CLINICAL_TABLE_TH} !px-2 !py-2`}>Discharge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={CLINICAL_TABLE_TBODY_TR}
                  onClick={() => setDetailRow(r)}
                >
                  <td className="px-2 py-2 text-xs">
                    <span className={wardBadgeClass(r.ward)}>{formatWardDisplay(r.ward)}</span>
                  </td>
                  <td className="px-2 py-2">{r.surname}</td>
                  <td className="px-2 py-2">{r.firstName}</td>
                  <td className="px-2 py-2 max-w-[140px] truncate" title={r.diagnosis}>
                    {r.diagnosis}
                  </td>
                  <td className="px-2 py-2">{r.bed}</td>
                  <td className="px-2 py-2 text-xs">{r.dateOfBirth}</td>
                  <td className="px-2 py-2 text-xs">{r.dateOfReview}</td>
                  <td className="px-2 py-2">{r.age}</td>
                  <td className="px-2 py-2">{r.sex}</td>
                  <td className="px-2 py-2 text-xs">{r.medicalAid}</td>
                  <td className="px-2 py-2 text-xs">{r.medicalAidNumber}</td>
                  <td className="px-2 py-2 text-xs">
                    {r.contactNumber ? (
                      <span className="inline-flex items-center gap-2 flex-wrap tabular-nums">
                        <span className="text-slate-800">{r.contactNumber}</span>
                        <span className="inline-flex gap-0.5 text-violet-600">
                          <a
                            href={`tel:${r.contactNumber.replace(/\s/g, '')}`}
                            className="p-1 rounded-md hover:bg-violet-100"
                            aria-label="Call"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={14} />
                          </a>
                          <a
                            href={`sms:${r.contactNumber.replace(/\s/g, '')}`}
                            className="p-1 rounded-md hover:bg-violet-100"
                            aria-label="Message"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageCircle size={14} />
                          </a>
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">{r.surgeon}</td>
                  <td className="px-2 py-2 text-xs max-w-[100px] truncate">{r.complications}</td>
                  <td className="px-2 py-2 text-xs max-w-[100px] truncate">{r.surgeonPlan}</td>
                  <td className="px-2 py-2 text-xs max-w-[100px] truncate">{r.managementPlan}</td>
                  <td className="px-2 py-2 text-xs">{r.dateOfDischarge}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ClinicalTableScroll>

      {detailRow && (
        <SurgeonRoundDetailPanel
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onRowUpdated={(r) => setDetailRow(r)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
};
