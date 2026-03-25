const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  readProviderProfileDraft,
  buildCompletedProviderProfile,
} = require("../dist/providerProfile.js");

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-vscode-test-"));
  return path.join(dir, "provider_test.json");
}

test("buildCompletedProviderProfile preserves extra auth and config draft fields", () => {
  const filePath = tmpFile();
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        kind: "provider",
        name: "cliproxyapi",
        auth: {
          OPENAI_API_KEY: "",
          extra_header: "x-test",
        },
        config: {
          name: "cliproxyapi",
          base_url: "http://example.local/v1",
          timeout_ms: 30000,
        },
      },
      null,
      2
    ),
    "utf-8"
  );

  const draft = readProviderProfileDraft(filePath, "cliproxyapi");
  assert.equal(draft.exists, true);
  assert.equal(draft.invalid, true);

  const profile = buildCompletedProviderProfile(
    "cliproxyapi",
    {
      kind: "provider",
      name: "cliproxyapi",
      auth: { OPENAI_API_KEY: "" },
      config: {
        name: "cliproxyapi",
        base_url: "",
        wire_api: "responses",
      },
    },
    draft,
    {
      apiKey: "sk-filled",
      baseUrl: "http://example.local/v1",
      wireApi: "responses",
    }
  );

  assert.equal(profile.auth.OPENAI_API_KEY, "sk-filled");
  assert.equal(profile.auth.extra_header, "x-test");
  assert.equal(profile.config.base_url, "http://example.local/v1");
  assert.equal(profile.config.wire_api, "responses");
  assert.equal(profile.config.timeout_ms, 30000);
});
