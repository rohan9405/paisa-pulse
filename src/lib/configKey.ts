/** Public key that verifies remote config signatures (backend/scripts/keygen.mjs). The private key never leaves the owner's Mac. */
export const CONFIG_PUBLIC_KEY = {
  "kty": "EC",
  "crv": "P-256",
  "x": "MgH3O5Yut2aYS5_gkjaGujf_eOaUTypzDTWff-NKju4",
  "y": "ItnczgTGrxdL_NRPv9rNculIobTgGoUBIIyK49BL2rI",
  "kid": "2026-10-23"
} as const;
