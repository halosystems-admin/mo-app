export function stringError(error) {
  if (!error) {
    return "unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return error.message ?? JSON.stringify(error);
}
