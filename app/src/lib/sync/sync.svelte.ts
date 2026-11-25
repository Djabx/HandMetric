/** État de la synchronisation (rempli par le client de sync en mode auto-hébergé). */
export const sync = $state({
  mode: 'solo' as 'solo' | 'server',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  status: 'idle' as 'idle' | 'syncing' | 'error',
  error: '',
  lastSyncAt: null as string | null,
  user: null as null | { id: string; display_name: string | null },
});
