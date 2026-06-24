export function bindProcessLifecycleFlush(state) {
  const flushOnExit = () => {
    state.sender.flush().catch(() => {});
  };

  process.on("beforeExit", flushOnExit);
  state.stopFns.push(() => {
    process.off("beforeExit", flushOnExit);
  });
}
