#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");
const readline = require("node:readline");
const {
  calculateProjection,
  createTrafficCore,
  ingestDelta,
} = require("../plugin/lib/traffic-core");

const [capturePath, ...args] = process.argv.slice(2);
if (!capturePath) {
  console.error(
    "Usage: node scripts/replay-capture.js <capture.jsonl[.gz]> [--self-context vessels....] [--profile coastal]",
  );
  process.exitCode = 1;
  return;
}

const options = parseArgs(args);
const state = createTrafficCore({
  sessionId: "offline-capture",
  profile: options.profile,
});
const examples = [];
let lines = 0;
let projectedEvents = 0;
const stateCounts = { normal: 0, alert: 0, warn: 0, alarm: 0, emergency: 0 };

const source = fs.createReadStream(capturePath);
const input = capturePath.endsWith(".gz") ? source.pipe(zlib.createGunzip()) : source;
const reader = readline.createInterface({ input, crlfDelay: Infinity });

reader.on("line", (line) => {
  lines += 1;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  let delta = record.delta;
  if (!delta) return;
  const originalContext = String(delta.context || "");
  if (originalContext === options.selfContext) {
    delta = { ...delta, context: "vessels.self" };
  }
  ingestDelta(state, delta);
  const projection = calculateProjection(
    state,
    record.capturedAt || new Date().toISOString(),
  );
  projectedEvents += 1;
  for (const target of projection.targets) {
    const state = target.encounter?.state || "normal";
    stateCounts[state] = (stateCounts[state] || 0) + 1;
    if (state !== "normal" && examples.length < 20) {
      examples.push({
        at: record.capturedAt,
        target: target.name,
        mmsi: target.mmsi,
        state,
        range: target.encounter.range,
        cpa: target.encounter.cpa,
        tcpa: target.encounter.tcpa,
      });
    }
  }
});

reader.on("close", () => {
  console.log(
    JSON.stringify(
      {
        capture: capturePath,
        profile: options.profile,
        selfContext: options.selfContext,
        lines,
        targetsSeen: state.targets.size,
        projectedEvents,
        finalSequence: state.sequence,
        stateCounts,
        alertExamples: examples,
      },
      null,
      2,
    ),
  );
});

reader.on("error", (error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

function parseArgs(values) {
  const parsed = {
    selfContext: "vessels.urn:mrn:imo:mmsi:235008635",
    profile: "harbor",
  };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--self-context") {
      parsed.selfContext = values[index + 1] || parsed.selfContext;
      index += 1;
    } else if (values[index] === "--profile") {
      const profile = values[index + 1];
      if (["anchor", "harbor", "coastal", "offshore"].includes(profile)) {
        parsed.profile = profile;
      }
      index += 1;
    }
  }
  return parsed;
}
