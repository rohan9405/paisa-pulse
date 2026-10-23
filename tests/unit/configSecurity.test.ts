import { describe, expect, it } from "vitest";
import { MAX_CONFIG_BYTES, bytesToBase64url, verifyEnvelope } from "@/lib/configSignature";
import { parseRemoteConfig } from "@/lib/remoteConfig";

async function keypair(kid: string) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { pub: { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid }, privateKey };
}
async function sign(payload: string, key: CryptoKey) {
  return bytesToBase64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload)));
}

describe("signed config", () => {
  it("accepts a config signed with the trusted key", async () => {
    const k = await keypair("k1");
    const payload = JSON.stringify({ version: 2, tabs: [] });
    expect(await verifyEnvelope({ payload, sig: await sign(payload, k.privateKey), kid: "k1" }, k.pub)).toEqual({ version: 2, tabs: [] });
  });

  it("rejects tampering, other keys, wrong key ids, unsigned and malformed input", async () => {
    const k = await keypair("k1");
    const attacker = await keypair("k1");
    const payload = JSON.stringify({ version: 2 });
    const sig = await sign(payload, k.privateKey);
    expect(await verifyEnvelope({ payload: JSON.stringify({ version: 3 }), sig, kid: "k1" }, k.pub)).toBeNull(); // payload changed after signing
    expect(await verifyEnvelope({ payload, sig: await sign(payload, attacker.privateKey), kid: "k1" }, k.pub)).toBeNull(); // someone else's key
    expect(await verifyEnvelope({ payload, sig, kid: "k2" }, k.pub)).toBeNull();
    expect(await verifyEnvelope({ version: 2 }, k.pub)).toBeNull(); // plain, unsigned config
    expect(await verifyEnvelope({ payload, sig: "", kid: "k1" }, k.pub)).toBeNull();
    expect(await verifyEnvelope({ payload, sig: "!!!", kid: "k1" }, k.pub)).toBeNull();
    expect(await verifyEnvelope("hello", k.pub)).toBeNull();
  });

  it("refuses oversized configs before checking them", async () => {
    const k = await keypair("k1");
    const payload = JSON.stringify({ version: 2, pad: "x".repeat(MAX_CONFIG_BYTES) });
    expect(await verifyEnvelope({ payload, sig: await sign(payload, k.privateKey), kid: "k1" }, k.pub)).toBeNull();
  });

  it("the built-in key rejects anything not signed by the owner", async () => {
    const attacker = await keypair("2026-10-23");
    const payload = JSON.stringify({ version: 99, announcement: { id: "x", text: "Verify your KYC" } });
    expect(await verifyEnvelope({ payload, sig: await sign(payload, attacker.privateKey), kid: "2026-10-23" })).toBeNull();
  });
});

describe("links and senders a config can't use", () => {
  const link = (url: string) => parseRemoteConfig({ version: 1, announcement: { id: "a", text: "t", link: url } });
  const update = (url: string) => parseRemoteConfig({ version: 1, update: { latestVersion: "0.9.0", url } }).config.update;

  it("only allows links into the app's own GitHub repo", () => {
    expect(link("https://github.com/rohan9405/paisa-pulse/releases/latest").config.announcement?.link).toBe("https://github.com/rohan9405/paisa-pulse/releases/latest");
    expect(update("https://github.com/rohan9405/paisa-pulse/releases/latest/download/PaisaPulse.apk")?.url).toContain("/rohan9405/paisa-pulse/");
    for (const bad of [
      "https://evil.example/kyc",
      "http://github.com/rohan9405/paisa-pulse/",
      "https://github.com/someone-else/paisa-pulse/",
      "https://github.com/rohan9405/paisa-pulse-fake/",
      "https://github.com.evil.example/rohan9405/paisa-pulse/",
      "https://user:pass@github.com/rohan9405/paisa-pulse/",
      "javascript:alert(1)",
      "intent://scan#Intent;end",
    ]) {
      expect(link(bad).config.announcement, bad).toBeNull();
      expect(update(bad), bad).toBeNull();
    }
  });

  it("never lets a phone number become a bank sender", () => {
    const { config } = parseRemoteConfig({ version: 1, banks: [{ sender: "919876543210", bank: "Fake" }, { sender: "1234", bank: "Fake" }, { sender: "YESBNK", bank: "Yes Bank" }] });
    expect(config.banks).toEqual([{ sender: "YESBNK", bank: "Yes Bank" }]);
  });

  it("text can't carry markup into the app (rendered as plain text)", () => {
    const { config } = parseRemoteConfig({ version: 1, screens: { stats: { title: "<img src=x onerror=alert(1)>" } } });
    expect(config.screens.stats?.title).toBe("<img src=x onerror=alert(1)>"); // stored as text; React escapes it, the app never uses innerHTML
  });
});
