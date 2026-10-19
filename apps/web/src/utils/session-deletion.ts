export async function removeSessionAfterWorkspaceCleanup(
  disposeTools: (() => Promise<void>) | undefined,
  removeSession: () => Promise<void>,
  reportCleanupFailure: (error: unknown) => void,
): Promise<void> {
  try {
    await disposeTools?.();
  } catch (error) {
    reportCleanupFailure(error);
  }

  await removeSession();
}
