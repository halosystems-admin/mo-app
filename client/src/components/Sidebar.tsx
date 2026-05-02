import React, { useState, useEffect, useRef } from 'react';
import type { Patient } from '../../../shared/types';
import { Plus, LogOut, Search, Trash2, ChevronRight, Users, Clock, Settings, LayoutGrid, FolderOpen, FileSpreadsheet } from 'lucide-react';
import { searchPatientsByConcept } from '../services/api';
import { patientAvatarClassWithSelection } from '../utils/patientAvatar';
import { formatPatientDisplayName } from '../features/clinical/shared/clinicalDisplay';
export type MainNavSection = 'ward' | 'sheets' | 'folders';

interface SidebarProps {
  mainNav: MainNavSection;
  onMainNav: (section: MainNavSection) => void;
  patients: Patient[];
  selectedPatientId: string | null;
  recentPatientIds: string[];
  onSelectPatient: (id: string) => void;
  onCreatePatient: () => void;
  onDeletePatient: (patient: Patient) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  currentUser?: { firstName: string; lastName: string; email: string };
}

const navItem = (active: boolean) =>
  active
    ? 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-teal-500/10 text-teal-900 border border-teal-500/20'
    : 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-slate-600 hover:bg-slate-100 border border-transparent';

export const Sidebar: React.FC<SidebarProps> = ({
  mainNav,
  onMainNav,
  patients,
  selectedPatientId,
  recentPatientIds,
  onSelectPatient,
  onCreatePatient,
  onDeletePatient,
  onLogout,
  onOpenSettings,
  currentUser,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [aiSearchResults, setAiSearchResults] = useState<string[] | null>(null);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const localFiltered = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.dob.includes(searchTerm)
  );

  useEffect(() => {
    if (mainNav !== 'folders') return;
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setAiSearchResults(null);

    if (!searchTerm.trim() || searchTerm.length < 3) return;

    if (localFiltered.length <= 2) {
      searchTimeoutRef.current = setTimeout(async () => {
        setIsAiSearching(true);
        try {
          const ids = await searchPatientsByConcept(searchTerm, patients, {});
          setAiSearchResults(ids);
        } catch {
          setAiSearchResults(null);
        }
        setIsAiSearching(false);
      }, 600);
    }

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchTerm, patients, mainNav, localFiltered.length]);

  const filteredPatients = searchTerm.trim()
    ? patients.filter((p) => {
        const localMatch =
          p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.dob.includes(searchTerm);
        const aiMatch = aiSearchResults?.includes(p.id) ?? false;
        return localMatch || aiMatch;
      })
    : patients;

  const recentPatients =
    recentPatientIds.length > 0
      ? recentPatientIds
          .map((id) => patients.find((p) => p.id === id))
          .filter((p): p is Patient => !!p)
          .slice(0, 3)
      : patients.slice(0, 3);

  const renderPatientRow = (patient: Patient, keyPrefix: string) => (
    <div
      key={`${keyPrefix}-${patient.id}`}
      onClick={() => onSelectPatient(patient.id)}
        className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all border mb-0.5 ${
        selectedPatientId === patient.id
          ? 'border-teal-200/80 bg-teal-50/90'
          : 'border-transparent hover:bg-slate-50 hover:border-slate-100'
      }`}
    >
      <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${patientAvatarClassWithSelection(
            patient.id,
            patient.name,
            selectedPatientId === patient.id
          )}`}
        >
          {(() => {
            const disp = formatPatientDisplayName(patient.name) || patient.name.trim();
            const ch = disp.includes(',')
              ? disp.split(',')[0]?.trim().charAt(0)
              : disp.charAt(0);
            return (ch || '?').toUpperCase();
          })()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate">
            {formatPatientDisplayName(patient.name) || patient.name}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onDeletePatient) onDeletePatient(patient);
          }}
          className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-50 hover:text-rose-600 text-slate-400"
          title="Delete folder"
          type="button"
        >
          <Trash2 size={14} />
        </button>
        <ChevronRight
          size={14}
          className={`text-slate-300 transition-opacity ${
            selectedPatientId === patient.id ? 'opacity-100 text-teal-500' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      </div>
    </div>
  );

  return (
    <div className="w-72 md:w-80 bg-[#f7f9fb] h-full flex flex-col text-slate-800 border-r border-slate-200/70">
      <div className="border-b border-slate-200/60 px-4 pb-4 pt-5">
        <div className="flex items-center justify-between gap-3 pl-2.5">
          <div className="flex min-w-0 flex-1 justify-center pr-3">
            <div className="flex items-center gap-5">
              <div className="flex flex-col items-center gap-0.5">
                <div className="h-7 w-8 overflow-hidden">
                  <img
                    src="/halo-brand-lockup-transparent.png"
                    alt="HALO icon"
                    className="block h-7 w-auto max-w-none select-none"
                    width={76}
                    height={28}
                    decoding="async"
                    draggable={false}
                  />
                </div>
                <span className="text-[0.82rem] font-semibold leading-none tracking-[0.16em] text-[#0f1c56]">HALO</span>
              </div>
              <div className="min-w-0 self-center pt-0.5">
                <p className="truncate text-[0.92rem] font-semibold text-slate-500">Dr Mohamed Patel</p>
              </div>
            </div>
          </div>
          <button
            onClick={onOpenSettings}
            className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-200/40 hover:text-slate-700"
            title="Settings"
            type="button"
          >
            <Settings size={18} />
          </button>
        </div>

        <nav className="mt-5 space-y-1">
          <button type="button" className={`w-full text-left text-[13px] font-medium ${navItem(mainNav === 'ward')}`} onClick={() => onMainNav('ward')}>
            <LayoutGrid size={16} className="shrink-0 opacity-80" />
            Ward
          </button>
          <button type="button" className={`w-full text-left text-[13px] font-medium ${navItem(mainNav === 'sheets')}`} onClick={() => onMainNav('sheets')}>
            <FileSpreadsheet size={16} className="shrink-0 opacity-80" />
            Sheets
          </button>
          <button type="button" className={`w-full text-left text-[13px] font-medium ${navItem(mainNav === 'folders')}`} onClick={() => onMainNav('folders')}>
            <FolderOpen size={16} className="shrink-0 opacity-80" />
            Patient folders
          </button>
        </nav>
      </div>

      {mainNav === 'folders' ? (
        <>
          <div className="px-4 pt-3 pb-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search patients…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50 text-sm pl-9 pr-3 py-2 rounded-lg outline-none border border-slate-200/90 focus:border-teal-300 focus:ring-1 focus:ring-teal-200 placeholder:text-slate-400"
              />
            </div>
            {isAiSearching && searchTerm.length >= 3 && (
              <p className="text-[10px] text-teal-500 mt-1.5 font-medium">Searching records…</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
            {!searchTerm && patients.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 px-1 mb-1.5">
                  <Clock size={11} className="text-slate-400" />
                  <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Recent</h3>
                </div>
                {recentPatients.map((p) => renderPatientRow(p, 'recent'))}
                <div className="my-3 border-t border-slate-100 mx-1" />
              </div>
            )}
            <div className="flex items-center gap-1.5 px-1 mb-1.5">
              <Users size={11} className="text-slate-400" />
              <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {searchTerm ? 'Results' : 'All'} <span className="font-normal opacity-70">({filteredPatients.length})</span>
              </h3>
            </div>
            {filteredPatients.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No patients</div>
            ) : (
              filteredPatients.map((p) => renderPatientRow(p, 'all'))
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0" aria-hidden="true" />
      )}

      <div className="p-3 border-t border-slate-100 bg-slate-50/50">
        {mainNav === 'folders' && (
          <button
            onClick={onCreatePatient}
            className="w-full bg-teal-500 hover:bg-teal-500/90 text-white py-2 rounded-md text-[12px] font-semibold flex items-center justify-center gap-1.5 mb-3 transition-colors shadow-sm"
            type="button"
          >
            <Plus size={16} /> New patient
          </button>
        )}
        {currentUser ? (
          <div className="mb-2 px-0.5 min-w-0">
            <p className="text-[11px] font-semibold text-slate-700 truncate" title={`${currentUser.firstName} ${currentUser.lastName}`.trim()}>
              {`${currentUser.firstName} ${currentUser.lastName}`.trim() || currentUser.email}
            </p>
            <p className="text-[10px] text-slate-400 truncate" title={currentUser.email}>
              {currentUser.email}
            </p>
          </div>
        ) : null}
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 py-2 transition-colors"
          type="button"
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
  );
};
