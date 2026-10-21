/** @jest-environment node */
import { hashCode, signingKey, hmacCheck, signedHeaders, H_CHECK, H_VERSION, H_TIMESTAMP } from "../transport/signer";

// Vectors = real output of the reference functions in fusion-ai-agent/mcp/src/orchestrator.js (Node crypto).
const TS = [1791547256, 1700000000, 86399];
const KEYS: Record<number, string> = {
  86399: "2607100|3oq|25|3oq|2941|5bd",
  1700000000: "2607100|3oq|2835|1svv|54838863|ob",
  1791547256: "2607100|3oq|2987|fm|57792001|312",
};
const PAYLOADS = ["", "move", 'Hello "there"', "привет ✓ 日本"];
const HMAC: Record<number, string[]> = {
  1791547256: [
    "5dFFZdHL1d_snwM7Lvm1GwtXOBCUnTOUFE_VIMtOVaQ",
    "DnZL2LwjMy85XUdWg67JXp5RNLWzvAf9MqUiCJhjx2w",
    "n5pfMd-blilQcXoC5tUMiBYNzHM7pP-nvrd_DZT__Sc",
    "sazHl6vPpu8irrGjQlnOjsq6zWC0tkirOSwtzpQY9_0",
  ],
  1700000000: [
    "6DFwQ-IpiY7k9IwZ6BmLdH2hmwh5LrrNZvfpaD8e40Q",
    "0D9NQ96UKdj6WyL8-WVNb_PcQUH4Zj_qMSD2A1E02aM",
    "EH6chOWRXMz2vmot6GJ9zUnCfSMYKa3nrx-piw8RkAE",
    "vv8Jc37SxulDaLjOVR3qc3jkV-U7znRRJBtOqW5R07M",
  ],
  86399: [
    "bWY5V3k34gSddeDKPxrF1tyRHlWaqv6hY83324azH6o",
    "eu5sw3KhyD4n_Td9bApkmX5cSB-e4aqLpjIdCWrJDlM",
    "fCamTcB-_eSVECnb-JVRuwS7R6pFj2_jtzQj2okfYoM",
    "pidGoksi1KJG1_mnu6nLyA3xrQbpDg_18pCsOuDI1UA",
  ],
};

describe("signer", () => {
  test("hashCode_matches_vendor_vectors", () => {
    expect(hashCode("2607100")).toBe(4778);
    expect(hashCode("")).toBe(0);
    expect(hashCode("abc")).toBe(49340);
  });

  test("signingKey_matches_vendor_vectors", () => {
    for (const ts of TS) expect(signingKey("2607100", ts)).toBe(KEYS[ts]);
  });

  test("hmacCheck_matches_vendor_vectors", async () => {
    for (const ts of TS)
      for (let i = 0; i < PAYLOADS.length; i++)
        expect(await hmacCheck(PAYLOADS[i], signingKey("2607100", ts))).toBe(HMAC[ts][i]);
  });

  test("signedHeaders_has_three_headers_and_version", async () => {
    const h = await signedHeaders("move", "2607100", 1791547256);
    expect(h).toEqual({
      [H_VERSION]: "2607100",
      [H_TIMESTAMP]: "1791547256",
      [H_CHECK]: HMAC[1791547256][1],
    });
    expect(Object.keys(h)).toHaveLength(3);
    const d = await signedHeaders("x", "2607100");
    expect(Number(d[H_TIMESTAMP])).toBeGreaterThan(1700000000);
  });
});
