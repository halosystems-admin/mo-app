import { useSyncExternalStore } from 'react';

export type ConsultationRecorderUiState = {
  isLive: boolean;
  isPaused: boolean;
  isBusy: boolean;
  isFinalizing: boolean;
  displayTime: string;
};

const DEFAULT_STATE: ConsultationRecorderUiState = {
  isLive: false,
  isPaused: false,
  isBusy: false,
  isFinalizing: false,
  displayTime: '00:00',
};

let state: ConsultationRecorderUiState = DEFAULT_STATE;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setConsultationRecorderUiState(
  patch: Partial<ConsultationRecorderUiState> | ((prev: ConsultationRecorderUiState) => ConsultationRecorderUiState)
): void {
  const next =
    typeof patch === 'function'
      ? (patch as (prev: ConsultationRecorderUiState) => ConsultationRecorderUiState)(state)
      : { ...state, ...patch };

  if (
    next.isLive === state.isLive &&
    next.isPaused === state.isPaused &&
    next.isBusy === state.isBusy &&
    next.isFinalizing === state.isFinalizing &&
    next.displayTime === state.displayTime
  ) {
    return;
  }

  state = next;
  emit();
}

export function getConsultationRecorderUiState(): ConsultationRecorderUiState {
  return state;
}

export function useConsultationRecorderUiState(): ConsultationRecorderUiState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getConsultationRecorderUiState,
    getConsultationRecorderUiState
  );
}

