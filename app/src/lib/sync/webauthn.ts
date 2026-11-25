// Conversion des options WebAuthn (JSON base64url de webauthn-rs) vers l'API du navigateur, et retour.

const b64urlToBuf = (s: string): ArrayBuffer => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const bufToB64url = (b: ArrayBuffer): string => {
  const bytes = new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export function supported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
}

/** Crée une passkey (identifiant découvrable) à partir des options du serveur. */
export async function create(options: Json): Promise<Json> {
  const pk = structuredClone(options.publicKey);
  pk.challenge = b64urlToBuf(pk.challenge);
  pk.user.id = b64urlToBuf(pk.user.id);
  pk.excludeCredentials = (pk.excludeCredentials ?? []).map((c: Json) => ({ ...c, id: b64urlToBuf(c.id) }));
  // Passkey découvrable : nécessaire pour se connecter sans identifiant.
  pk.authenticatorSelection = { ...(pk.authenticatorSelection ?? {}), residentKey: 'required', requireResidentKey: true, userVerification: 'required' };
  const cred = (await navigator.credentials.create({ publicKey: pk })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Annulé');
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    extensions: cred.getClientExtensionResults?.() ?? {},
    response: {
      attestationObject: bufToB64url(r.attestationObject),
      clientDataJSON: bufToB64url(r.clientDataJSON),
      transports: r.getTransports?.() ?? undefined,
    },
  };
}

/** Authentification par passkey découvrable. */
export async function get(options: Json): Promise<Json> {
  const pk = structuredClone(options.publicKey);
  pk.challenge = b64urlToBuf(pk.challenge);
  pk.allowCredentials = (pk.allowCredentials ?? []).map((c: Json) => ({ ...c, id: b64urlToBuf(c.id) }));
  const cred = (await navigator.credentials.get({ publicKey: pk })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Annulé');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    extensions: cred.getClientExtensionResults?.() ?? {},
    response: {
      authenticatorData: bufToB64url(r.authenticatorData),
      clientDataJSON: bufToB64url(r.clientDataJSON),
      signature: bufToB64url(r.signature),
      userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
    },
  };
}
