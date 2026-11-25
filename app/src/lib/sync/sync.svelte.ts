export interface Health {
  name: string;
  version: string;
  auth: {
    registration: boolean;
    passkey: boolean;
    passkey_registration: boolean;
    oidc: { id: string; name: string }[];
  };
}

export interface Identity {
  id: string;
  kind: 'oidc' | 'passkey';
  provider: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

/** État de la synchronisation (rempli par le client de sync en mode auto-hébergé). */
export const sync = $state({
  mode: 'solo' as 'solo' | 'server',
  health: null as Health | null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  status: 'idle' as 'idle' | 'syncing' | 'error',
  error: '',
  lastSyncAt: null as string | null,
  user: null as null | { id: string; display_name: string | null },
  identities: [] as Identity[],
});
