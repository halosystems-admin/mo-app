import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { PatientWorkspace } from './pages/PatientWorkspace';
import { Toast } from './components/Toast';
import { SettingsModal } from './components/SettingsModal';
import {
  checkAuth,
  loginWithPassword,
  logout,
  fetchAllPatients,
  warmAndListFiles,
  createPatient,
  deletePatient,
  loadSettings,
  saveSettings,
  ApiError,
  extractPatientFromStickerFile,
  uploadFile,
  uploadPatientHaloProfile,
  type CurrentUser,
} from './services/api';
import type { Patient, UserSettings } from '../../shared/types';
import { DEFAULT_HALO_TEMPLATE_ID } from '../../shared/haloTemplates';
import {
  LogIn,
  Loader,
  X,
  UserPlus,
  Calendar,
  Users,
  AlertTriangle,
  Trash2,
  Menu,
  Camera,
  Upload,
  LayoutGrid,
  FileSpreadsheet,
  FolderOpen,
  Mic,
} from 'lucide-react';
import { requestOpenSheetsDictate } from './lib/sheetsDictateBridge';
import { WardPage } from './pages/WardPage';
import { SheetsPage } from './pages/SheetsPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { StickerCameraModal } from './components/StickerCameraModal';
import { formatPatientDisplayName } from './features/clinical/shared/clinicalDisplay';
import type { MainNavSection } from './components/Sidebar';

export const App = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    () => sessionStorage.getItem('halo_selectedPatientId')
  );
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null);

  const [newPatientName, setNewPatientName] = useState("");
  const [newPatientDob, setNewPatientDob] = useState("");
  const [newPatientSex, setNewPatientSex] = useState<'M' | 'F'>('M');
  const [stickerFile, setStickerFile] = useState<File | null>(null);
  const [stickerBusy, setStickerBusy] = useState(false);
  const emptyStickerProfile = () => ({
    idNumber: '',
    folderNumber: '',
    ward: '',
    medicalAidName: '',
    medicalAidPackage: '',
    medicalAidMemberNumber: '',
    medicalAidPhone: '',
    rawNotes: '',
  });
  const [stickerProfile, setStickerProfile] = useState(emptyStickerProfile);
  const createStickerInputRef = useRef<HTMLInputElement>(null);
  const [showStickerCamera, setShowStickerCamera] = useState(false);

  // Settings / profile state
  const [showSettings, setShowSettings] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [loginTime] = useState<number>(Date.now());

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Recently opened patients (stored in localStorage)
  const [recentPatientIds, setRecentPatientIds] = useState<string[]>(
    () => {
      try {
        return JSON.parse(localStorage.getItem('halo_recentPatientIds') || '[]');
      } catch { return []; }
    }
  );

  const [mainNav, setMainNav] = useState<MainNavSection>('folders');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  /** Mobile ward board: scroll to this column once after password login. */
  const [wardLoginScrollColumnId, setWardLoginScrollColumnId] = useState<string | null>(null);

  // Persist selected patient to sessionStorage so it survives page refresh
  // Also track recently opened patients in localStorage
  const selectPatient = useCallback((id: string | null) => {
    setSelectedPatientId(id);
    if (id) {
      sessionStorage.setItem('halo_selectedPatientId', id);
      // Push to recent list (most recent first, deduped, max 3)
      setRecentPatientIds(prev => {
        const updated = [id, ...prev.filter(pid => pid !== id)].slice(0, 3);
        localStorage.setItem('halo_recentPatientIds', JSON.stringify(updated));
        return updated;
      });
    } else {
      sessionStorage.removeItem('halo_selectedPatientId');
    }
  }, []);

  const openPatientWorkspace = useCallback((id: string) => {
    selectPatient(id);
    setMainNav('folders');
  }, [selectPatient]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  }, []);

  // OAuth callback redirects (admin consent / errors) land on CLIENT_URL with query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let strip = false;
    if (params.get('admin_consent') === 'ok') {
      showToast('Microsoft admin consent completed for your organization. You can sign in below.', 'success');
      params.delete('admin_consent');
      strip = true;
    }
    const authErr = params.get('auth_error');
    if (authErr) {
      showToast(decodeURIComponent(authErr.replace(/\+/g, ' ')), 'error');
      params.delete('auth_error');
      strip = true;
    }
    if (strip) {
      const q = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
    }
  }, [showToast]);

  const getErrorMessage = (err: unknown): string => {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return 'An unexpected error occurred.';
  };

  const refreshPatients = useCallback(async (): Promise<Patient[]> => {
    const data = await fetchAllPatients();
    setPatients(data);
    return data;
  }, []);

  // Check if user has an active session
  useEffect(() => {
    const checkSession = async () => {
      try {
        // First verify server is reachable
        const healthCheck = await fetch('/api/health', { credentials: 'include' }).catch(() => null);
        if (!healthCheck || !healthCheck.ok) {
          console.warn('Server health check failed - make sure server is running on port 3001');
        }
        
        const auth = await checkAuth();
        if (auth.signedIn && auth.user) {
          setIsSignedIn(true);
          setCurrentUser(auth.user);
          const loadedPatients = await refreshPatients();
          // Validate stored patient selection — clear if patient no longer exists
          const storedId = sessionStorage.getItem('halo_selectedPatientId');
          if (storedId && !loadedPatients.find(p => p.id === storedId)) {
            selectPatient(null);
          }
          // Prefetch file list for the patient most likely to be opened (warms Drive + server cache)
          const prefetchId = storedId && loadedPatients.some(p => p.id === storedId)
            ? storedId
            : loadedPatients[0]?.id;
          if (prefetchId) {
            warmAndListFiles(prefetchId, 24).catch(() => {});
          }
          // Load settings in background
          loadSettings().then(res => {
            if (res.settings) setUserSettings(res.settings);
          }).catch(() => {});

        }
      } catch (error) {
        console.error('Session check failed:', error);
      }
      setIsReady(true);
    };
    checkSession();
  }, []);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [loginProfile, setLoginProfile] = useState<'mo' | 'henk' | 'other'>(() => {
    const raw = localStorage.getItem('halo_loginProfile');
    return raw === 'mo' || raw === 'henk' || raw === 'other' ? raw : 'mo';
  });
  const [loginStep, setLoginStep] = useState<'choose' | 'password'>(() => 'choose');

  useEffect(() => {
    const emailForProfile =
      loginProfile === 'mo'
        ? 'mo@practice.halo.africa'
        : loginProfile === 'henk'
          ? 'henk.kruger90@gmail.com'
          : '';
    if (loginProfile !== 'other') setLoginEmail(emailForProfile);
    localStorage.setItem('halo_loginProfile', loginProfile);
  }, [loginProfile]);

  const handleSignIn = async () => {
    setLoading(true);
    setLoginError(null);
    try {
      const { user } = await loginWithPassword(loginEmail, loginPassword);
      setCurrentUser(user);
      setIsSignedIn(true);
      setWardLoginScrollColumnId(user.defaultWardColumnId ?? null);
      setMainNav('ward');
      await refreshPatients();
      loadSettings()
        .then((res) => {
          if (res.settings) setUserSettings(res.settings);
        })
        .catch(() => {});
    } catch (error) {
      const msg = getErrorMessage(error);
      setLoginError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    setIsSignedIn(false);
    setCurrentUser(null);
    selectPatient(null);
    setMainNav('folders');
    setWardLoginScrollColumnId(null);
  };

  const openCreateModal = () => {
    setLoading(false);
    setStickerFile(null);
    setStickerProfile(emptyStickerProfile());
    setShowCreateModal(true);
  };

  const applyStickerFromFile = async (f: File) => {
    if (!f.type.startsWith('image/')) {
      showToast('Please use an image file.', 'info');
      return;
    }
    setStickerFile(f);
    setStickerBusy(true);
    try {
      const ex = await extractPatientFromStickerFile(f);
      if (ex.name?.trim()) setNewPatientName(ex.name.trim());
      if (ex.dob?.trim()) {
        const d = ex.dob.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) setNewPatientDob(d);
      }
      if (ex.sex === 'M' || ex.sex === 'F') setNewPatientSex(ex.sex);
      setStickerProfile({
        idNumber: ex.idNumber?.trim() ?? '',
        folderNumber: ex.folderNumber?.trim() ?? '',
        ward: ex.ward?.trim() ?? '',
        medicalAidName: ex.medicalAidName?.trim() ?? '',
        medicalAidPackage: ex.medicalAidPackage?.trim() ?? '',
        medicalAidMemberNumber: ex.medicalAidMemberNumber?.trim() ?? '',
        medicalAidPhone: ex.medicalAidPhone?.trim() ?? '',
        rawNotes: ex.rawNotes?.trim() ?? '',
      });
      showToast('Review fields, then create folder.', 'success');
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
      setStickerFile(null);
    } finally {
      setStickerBusy(false);
    }
  };

  const handleStickerImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await applyStickerFromFile(f);
  };

  const submitCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientName.trim()) return;

    setLoading(true);
    try {
      const newP = await createPatient(newPatientName, newPatientDob, newPatientSex);
      if (newP) {
        if (stickerFile) {
          try {
            const ext = stickerFile.name.includes('.') ? stickerFile.name.split('.').pop() : 'jpg';
            await uploadFile(newP.id, stickerFile, `patient_sticker_${Date.now()}.${ext}`);
          } catch {
            showToast('Folder created; upload the photo again from the patient workspace if needed.', 'info');
          }
        }
        try {
          await uploadPatientHaloProfile(newP.id, {
            version: 1,
            fullName: newPatientName.trim(),
            dob: newPatientDob,
            sex: newPatientSex,
            idNumber: stickerProfile.idNumber.trim() || undefined,
            folderNumber: stickerProfile.folderNumber.trim() || undefined,
            ward: stickerProfile.ward.trim() || undefined,
            medicalAidName: stickerProfile.medicalAidName.trim() || undefined,
            medicalAidPackage: stickerProfile.medicalAidPackage.trim() || undefined,
            medicalAidMemberNumber: stickerProfile.medicalAidMemberNumber.trim() || undefined,
            medicalAidPhone: stickerProfile.medicalAidPhone.trim() || undefined,
            rawNotes: stickerProfile.rawNotes.trim() || undefined,
            updatedAt: new Date().toISOString(),
          });
        } catch {
          showToast('Folder created; profile file could not be saved — you can re-enter details later.', 'info');
        }
        await refreshPatients();
        setShowCreateModal(false);
        setNewPatientName("");
        setNewPatientDob("");
        setNewPatientSex("M");
        setStickerFile(null);
        setStickerProfile(emptyStickerProfile());
        showToast('Patient folder created successfully.', 'success');
      }
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (settings: UserSettings) => {
    await saveSettings(settings);
    setUserSettings(settings);
    showToast('Settings saved.', 'success');
  };

  const handleDeleteRequest = (patient: Patient) => {
    setPatientToDelete(patient);
  };

  const confirmDelete = async () => {
    if (!patientToDelete) return;
    setLoading(true);
    try {
      await deletePatient(patientToDelete.id);
      await refreshPatients();
      if (selectedPatientId === patientToDelete.id) selectPatient(null);
      setPatientToDelete(null);
      showToast('Patient folder moved to trash.', 'success');
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileSidebarOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileSidebarOpen]);

  if (!isReady) {
    return (
      <div className="flex min-h-0 flex-1 h-screen w-full items-center justify-center bg-[#f7f9fb]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative isolate flex justify-center px-4">
            <img
              src="/halo-brand-lockup-transparent.png"
              alt="HALO"
              className="h-12 w-auto max-w-[240px] object-contain object-left select-none"
              decoding="async"
              draggable={false}
            />
          </div>
          <Loader className="animate-spin text-teal-500/90" size={24} />
          <p className="text-xs text-slate-500 font-medium">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    // Accept invite flow (no router)
    const params = new URLSearchParams(window.location.search);
    const inviteToken = window.location.pathname === '/accept-invite' ? params.get('token') : null;
    if (inviteToken) {
      return (
        <AcceptInvitePage
          token={inviteToken}
          onToast={showToast}
          onDone={() => {
            // Strip token from URL, then let normal session boot continue.
            window.history.replaceState({}, '', '/');
            window.location.reload();
          }}
        />
      );
    }

    return (
      <div className="flex min-h-0 flex-1 h-screen w-full items-center justify-center bg-white">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center px-6">
          <img
            src="/halo-brand-lockup-transparent.png"
            alt="HALO"
            className="h-12 w-auto max-w-[240px] mx-auto mb-6 object-contain select-none"
            draggable={false}
          />
          <h1 className="text-center text-2xl font-bold text-slate-800 mb-1">{loginStep === 'choose' ? 'Welcome' : 'Sign in'}</h1>
          <p className="text-center text-sm text-slate-500 mb-6">
            {loginStep === 'choose' ? 'Choose your profile.' : 'Enter your password.'}
          </p>

          {loginStep === 'choose' ? (
            <div className="mb-5 w-full flex flex-col gap-2 text-left">
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLoginProfile('mo');
                    setLoginPassword('');
                    setLoginError(null);
                    setLoginStep('password');
                    setTimeout(() => passwordInputRef.current?.focus(), 0);
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-3 text-left transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800 truncate">Dr Mohamed Patel</div>
                      <div className="text-xs font-semibold text-slate-500 truncate">mo@practice.halo.africa</div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLoginProfile('henk');
                    setLoginPassword('');
                    setLoginError(null);
                    setLoginStep('password');
                    setTimeout(() => passwordInputRef.current?.focus(), 0);
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-3 text-left transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800 truncate">Dr Henk Kruger</div>
                      <div className="text-xs font-semibold text-slate-500 truncate">henk.kruger90@gmail.com</div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLoginProfile('other');
                    setLoginEmail('');
                    setLoginPassword('');
                    setLoginError(null);
                    setLoginStep('password');
                    setTimeout(() => passwordInputRef.current?.focus(), 0);
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-3 text-left transition"
                >
                  <div className="text-sm font-bold text-slate-800">Other user</div>
                  <div className="text-xs font-semibold text-slate-500">Enter email manually</div>
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-5 w-full text-left">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Signing in as</div>
                <div className="text-sm font-bold text-slate-800">
                  {loginProfile === 'mo' ? 'Dr Mohamed Patel' : loginProfile === 'henk' ? 'Dr Henk Kruger' : 'User'}
                </div>
                <div className="text-xs font-semibold text-slate-600 break-all">{loginEmail}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLoginPassword('');
                  setLoginError(null);
                  setLoginStep('choose');
                }}
                className="mt-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
              >
                Change account
              </button>
            </div>
          )}

          {loginStep === 'password' ? (
            <div className="mb-5 w-full flex flex-col gap-3 text-left">
              {loginProfile === 'other' ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-slate-600">Email</span>
                  <input
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold"
                    autoComplete="email"
                    inputMode="email"
                  />
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">Password</span>
                <input
                  ref={passwordInputRef}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  type="password"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSignIn();
                  }}
                />
              </label>
              {loginError ? <p className="text-xs text-rose-600">{loginError}</p> : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={loginStep !== 'password'}
            className="w-full flex items-center justify-center gap-3 bg-teal-600 hover:bg-teal-700 text-white px-6 py-4 rounded-xl transition-all shadow-md hover:shadow-lg font-semibold text-lg active:scale-[0.98]"
          >
            {loading ? <Loader className="animate-spin" /> : <LogIn size={20} />}
            {loading ? 'Signing in...' : `Sign In`}
          </button>

          <p className="mt-8 text-center text-xs text-slate-400">Secure Environment &bull; POPIA Compliant</p>
        </div>
      </div>
    );
  }

  const activePatient = patients.find(p => p.id === selectedPatientId);

  return (
    <div className="flex h-screen min-h-0 min-w-0 flex-1 bg-slate-50 font-sans text-slate-900 overflow-hidden overscroll-x-none relative">
      {/* Mobile navigation drawer (patients, calendar, settings, logout) */}

      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileSidebarOpen(false)}
            role="button"
            tabIndex={0}
          />
          <div className="absolute left-0 top-0 bottom-0 w-80">
            <Sidebar
              mainNav={mainNav}
              onMainNav={(section) => {
                setMainNav(section);
                setMobileSidebarOpen(false);
              }}
              patients={patients}
              selectedPatientId={selectedPatientId}
              recentPatientIds={recentPatientIds}
              onSelectPatient={(id) => {
                openPatientWorkspace(id);
                setMobileSidebarOpen(false);
              }}
              onCreatePatient={() => {
                openCreateModal();
                setMobileSidebarOpen(false);
              }}
              onDeletePatient={(p) => {
                setMobileSidebarOpen(false);
                handleDeleteRequest(p);
              }}
              onLogout={() => {
                setMobileSidebarOpen(false);
                void handleLogout();
              }}
              onOpenSettings={() => {
                setMobileSidebarOpen(false);
                setShowSettings(true);
              }}
              currentUser={currentUser ? { firstName: currentUser.firstName, lastName: currentUser.lastName, email: currentUser.email } : undefined}
            />
          </div>
        </div>
      )}

      <div className="hidden md:flex h-full shrink-0 z-20">
        <Sidebar
          mainNav={mainNav}
          onMainNav={setMainNav}
          patients={patients}
          selectedPatientId={selectedPatientId}
          recentPatientIds={recentPatientIds}
          onSelectPatient={openPatientWorkspace}
          onCreatePatient={openCreateModal}
          onDeletePatient={handleDeleteRequest}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettings(true)}
          currentUser={currentUser ? { firstName: currentUser.firstName, lastName: currentUser.lastName, email: currentUser.email } : undefined}
        />
      </div>

      <div
        className={`flex flex-1 min-h-0 min-w-0 flex-col relative overscroll-x-none overflow-x-hidden h-screen ${
          isSignedIn ? 'max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]' : ''
        }`}
      >
        {isSignedIn ? (
          <header className="md:hidden flex items-center gap-4 px-4 pt-3 pb-2 bg-halo-bg shrink-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="halo-touch-min inline-flex items-center justify-center rounded-xl bg-white/90 backdrop-blur border border-slate-200 shadow-sm text-slate-700"
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={mobileSidebarOpen}
            >
              <Menu size={20} />
            </button>
            <h1 className="min-w-0 flex-1 text-lg font-semibold text-halo-text tracking-tight truncate">
              {mainNav === 'ward'
                ? 'Ward'
                : mainNav === 'sheets'
                  ? 'Sheets'
                  : activePatient
                    ? formatPatientDisplayName(activePatient.name) || activePatient.name
                    : 'Folders'}
            </h1>
          </header>
        ) : null}
        {mainNav === 'ward' ? (
          <WardPage
            patients={patients}
            onOpenPatient={(id) => {
              openPatientWorkspace(id);
            }}
            onToast={showToast}
            initialWardColumnScrollId={wardLoginScrollColumnId}
            onInitialWardColumnScrolled={() => setWardLoginScrollColumnId(null)}
          />
        ) : mainNav === 'sheets' ? (
          <SheetsPage
            patients={patients}
            userSettings={userSettings}
            onToast={showToast}
            onOpenPatient={(id) => openPatientWorkspace(id)}
          />
        ) : activePatient ? (
          <PatientWorkspace
            key={activePatient.id}
            patient={activePatient}
            onBack={() => selectPatient(null)}
            onDataChange={refreshPatients}
            onToast={showToast}
            templateId={userSettings?.templateId || DEFAULT_HALO_TEMPLATE_ID}
            calendarPrepEvent={null}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-slate-300 relative overflow-hidden">
            {/* Background logo — large watermark */}
            <img
              src="/halo-logo.png"
              alt=""
              aria-hidden="true"
              className="absolute opacity-[0.04] pointer-events-none select-none w-[70vw] max-w-[700px] min-w-[300px] md:w-[55vw] lg:w-[45vw]"
              draggable={false}
            />
            {/* Foreground content */}
            <div className="relative z-10 flex flex-col items-center text-center px-6">
              <img
                src="/halo-logo.png"
                alt="Dr Mohamed Patel"
                className="w-44 h-44 md:w-56 md:h-56 lg:w-64 lg:h-64 object-contain mb-6 opacity-20"
                draggable={false}
              />
              <p className="text-lg font-medium text-slate-400">Select a patient to begin</p>
            </div>
          </div>
        )}
      </div>

      {/* TOAST NOTIFICATIONS */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* SETTINGS MODAL */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={userSettings}
        onSave={handleSaveSettings}
        currentUser={currentUser ? { firstName: currentUser.firstName, lastName: currentUser.lastName, email: currentUser.email, role: currentUser.role } : undefined}
        loginTime={loginTime}
        onToast={showToast}
      />

      {/* CREATE PATIENT MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 my-4 max-h-[min(92vh,900px)] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><UserPlus className="text-teal-600" size={24}/> New Patient Folder</h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setStickerFile(null);
                  setStickerProfile(emptyStickerProfile());
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"
              >
                <X size={20} />
              </button>
            </div>
            <input
              ref={createStickerInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleStickerImage}
            />
            <form onSubmit={submitCreatePatient}>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={stickerBusy || loading}
                    onClick={() => createStickerInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-teal-200 bg-teal-50 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50"
                  >
                    {stickerBusy ? <Loader className="animate-spin w-4 h-4" /> : <Upload className="w-4 h-4" />}
                    {stickerBusy ? 'Scanning…' : 'Gallery / file'}
                  </button>
                  <button
                    type="button"
                    disabled={stickerBusy || loading}
                    onClick={() => setShowStickerCamera(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Camera className="w-4 h-4" />
                    Live camera
                  </button>
                  {stickerFile ? (
                    <span className="text-xs text-slate-600 self-center truncate max-w-[200px]" title={stickerFile.name}>
                      {stickerFile.name}
                    </span>
                  ) : null}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">Full Name</label>
                  <input autoFocus type="text" placeholder="e.g. Sarah Connor" value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition" />
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Calendar size={14} /> Date of Birth</label>
                    <input type="date" value={newPatientDob} onChange={(e) => setNewPatientDob(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 outline-none transition" />
                  </div>
                  <div className="w-1/3">
                    <label className="block text-sm font-semibold text-slate-600 mb-1.5 flex items-center gap-1"><Users size={14} /> Sex</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button type="button" onClick={() => setNewPatientSex('M')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${newPatientSex === 'M' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>M</button>
                      <button type="button" onClick={() => setNewPatientSex('F')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${newPatientSex === 'F' ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>F</button>
                    </div>
                  </div>
                </div>
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-teal-800">Hospital ID &amp; billing</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">ID / hospital number</label>
                      <input type="text" value={stickerProfile.idNumber} onChange={(e) => setStickerProfile((p) => ({ ...p, idNumber: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Folder / file number</label>
                      <input type="text" value={stickerProfile.folderNumber} onChange={(e) => setStickerProfile((p) => ({ ...p, folderNumber: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Ward</label>
                      <input type="text" value={stickerProfile.ward} onChange={(e) => setStickerProfile((p) => ({ ...p, ward: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Medical aid / insurer</label>
                      <input type="text" value={stickerProfile.medicalAidName} onChange={(e) => setStickerProfile((p) => ({ ...p, medicalAidName: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Plan / package</label>
                      <input type="text" value={stickerProfile.medicalAidPackage} onChange={(e) => setStickerProfile((p) => ({ ...p, medicalAidPackage: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Member number</label>
                      <input type="text" value={stickerProfile.medicalAidMemberNumber} onChange={(e) => setStickerProfile((p) => ({ ...p, medicalAidMemberNumber: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Scheme phone (authorisation)</label>
                      <input type="text" value={stickerProfile.medicalAidPhone} onChange={(e) => setStickerProfile((p) => ({ ...p, medicalAidPhone: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Other notes from sticker</label>
                      <textarea value={stickerProfile.rawNotes} onChange={(e) => setStickerProfile((p) => ({ ...p, rawNotes: e.target.value }))} rows={2} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none" />
                    </div>
                  </div>
                </div>
                <div className="pt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setStickerFile(null);
                      setStickerProfile(emptyStickerProfile());
                    }}
                    className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition"
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={!newPatientName.trim() || loading} className="flex-1 bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-teal-600/20 disabled:opacity-50 disabled:shadow-none transition flex items-center justify-center gap-2">
                    {loading ? <Loader className="animate-spin" size={18}/> : 'Create Folder'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <StickerCameraModal
        isOpen={showStickerCamera}
        onClose={() => setShowStickerCamera(false)}
        onCapture={(file) => void applyStickerFromFile(file)}
      />

      {isSignedIn && (
        <>
          <nav
            className={`md:hidden fixed inset-x-0 bottom-0 z-[45] items-stretch justify-around gap-1 border-t border-slate-200/90 bg-white/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur-sm ${
              mobileSidebarOpen ? 'hidden' : 'flex'
            }`}
            aria-label="Main sections"
          >
            <button
              type="button"
              onClick={() => setMainNav('ward')}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                mainNav === 'ward' ? 'text-teal-700 bg-teal-50' : 'text-slate-500'
              }`}
            >
              <LayoutGrid size={22} strokeWidth={mainNav === 'ward' ? 2.25 : 2} />
              Ward
            </button>
            <button
              type="button"
              onClick={() => setMainNav('sheets')}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                mainNav === 'sheets' ? 'text-teal-700 bg-teal-50' : 'text-slate-500'
              }`}
            >
              <FileSpreadsheet size={22} strokeWidth={mainNav === 'sheets' ? 2.25 : 2} />
              Sheets
            </button>
            <button
              type="button"
              onClick={() => {
                setMainNav('folders');
                setMobileSidebarOpen(true);
              }}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                mainNav === 'folders' ? 'text-teal-700 bg-teal-50' : 'text-slate-500'
              }`}
            >
              <FolderOpen size={22} strokeWidth={mainNav === 'folders' ? 2.25 : 2} />
              Folders
            </button>
          </nav>

          {mainNav === 'folders' && !mobileSidebarOpen ? (
            <button
              type="button"
              onClick={() => {
                // Patient workspace: trigger consultation dictation (same logic as the header pill button).
                if (activePatient) {
                  window.dispatchEvent(new Event('halo:toggle-consultation-dictation'));
                  return;
                }
                // Fallback: open the Sheets dictate flow (used outside PatientWorkspace).
                requestOpenSheetsDictate();
              }}
              className="md:hidden fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-1/2 z-50 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-900/20 active:scale-95 transition-transform border-4"
              style={{ borderColor: 'var(--color-halo-bg)' }}
              aria-label="Dictate"
              title="Dictate"
            >
              <Mic size={26} strokeWidth={2} />
            </button>
          ) : null}
        </>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {patientToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 m-4 border-2 border-rose-100">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mb-4 text-rose-500">
                <AlertTriangle size={32} />
              </div>
              <h2 className="text-xl font-bold text-slate-800">Delete Patient Folder?</h2>
              <p className="text-slate-500 mt-2 px-4">
                Are you sure you want to delete <span className="font-bold text-slate-800">{patientToDelete.name}</span>?
                This will move the folder to your storage trash.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPatientToDelete(null)} className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={confirmDelete} className="flex-1 bg-rose-500 hover:bg-rose-600 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-rose-500/20 transition flex items-center justify-center gap-2">
                {loading ? <Loader className="animate-spin" size={18}/> : <Trash2 size={18}/>}
                Delete Folder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
