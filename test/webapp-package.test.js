"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const packageInfo = require("../package.json");

test("Engine bundles its own administration webapp", () => {
  assert.ok(packageInfo.keywords.includes("signalk-node-server-plugin"));
  assert.ok(packageInfo.keywords.includes("signalk-webapp"));
  assert.ok(packageInfo.files.includes("public"));
  assert.equal(packageInfo.signalk.appIcon, "./icon.svg");
  for (const file of ["index.html", "app.js", "styles.css", "icon.svg"]) {
    assert.ok(fs.existsSync(path.join(__dirname, "..", "public", file)));
  }
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(html, /Profile settings/);
  assert.match(html, /Automute stationary in this profile/);
  assert.match(html, /Traffic advisory/);
  assert.match(html, /Collision alarm/);
  assert.match(html, /All's well reassurance/);
  assert.match(html, /Browser playback is enabled separately/);
  assert.match(html, /Runtime changes need Signal K write access/);
  assert.match(app, /\$\{COMMAND_PATH\}\/profiles/);
  assert.match(app, /Enable audio/);
  assert.match(app, /Mute audio/);
  assert.match(app, /allWellMessage/);
  assert.match(app, /allWellIntervalMinutes/);
  assert.match(app, /profileAutomuteStationary/);
  assert.match(app, /setEditableInputValue/);
  assert.match(app, /document\.activeElement === input/);
  assert.match(app, /event\.key === "Enter"/);
  assert.match(app, /warning.*danger/s);
  assert.match(app, /let editingProfile = null/);
  assert.doesNotMatch(app, /profileDraft\.current = els\.editProfile\.value/);
});
