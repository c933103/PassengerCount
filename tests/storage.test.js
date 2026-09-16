import test from "node:test";
import assert from "node:assert/strict";
import { load, save, loadSurveyor, saveSurveyor } from "../storage.js";

test("Android surveys and profile survive loss of all browser storage", () => {
  const disk = new Map();
  globalThis.PassengerCountAndroid = {
    get: (key) => disk.get(key) ?? null,
    set: (key, value) => {
      disk.set(key, value);
      return true;
    },
  };
  globalThis.localStorage = {
    getItem() {
      throw Error("Browser storage was cleared");
    },
    setItem() {
      throw Error("Browser storage unavailable");
    },
  };
  const survey = {
    version: 2,
    currentId: "trip",
    surveys: [
      {
        id: "trip",
        activeIndex: 3,
        startIndex: 2,
        rows: [{ boarding: "0", onboard: "12" }],
      },
    ],
    search: { number: "1" },
  };
  saveSurveyor("Surveyor");
  save(survey);
  assert.deepEqual(load(), survey);
  assert.equal(loadSurveyor(), "Surveyor");
  globalThis.PassengerCountAndroid.set = () => false;
  assert.throws(() => save(survey), /write failed/);
  delete globalThis.PassengerCountAndroid;
  delete globalThis.localStorage;
});

test("website still persists without the Android bridge", () => {
  const disk = new Map();
  globalThis.localStorage = {
    getItem: (key) => disk.get(key) ?? null,
    setItem: (key, value) => disk.set(key, value),
  };
  const state = load();
  save(state);
  saveSurveyor("Name");
  assert.deepEqual(load(), state);
  assert.equal(loadSurveyor(), "Name");
  delete globalThis.localStorage;
});
