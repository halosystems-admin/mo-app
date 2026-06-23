export function noteGeneratedPayload() {
  return { type: "note.generated" };
}

export function transcriptionProcessedPayload(audioMinutes) {
  if (typeof audioMinutes !== "number" || Number.isNaN(audioMinutes) || audioMinutes < 0) {
    throw new Error("audioMinutes must be a non-negative number");
  }

  return {
    type: "transcription.processed",
    audio_minutes: audioMinutes
  };
}

export function messageSentPayload({ billable = true } = {}) {
  return {
    type: "message.sent",
    billable: billable === true
  };
}
