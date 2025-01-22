import { join } from "node:path";
import keyvTestSuite from "@keyv/test-suite";
import Keyv from "keyv";
import * as test from "vitest";
import { KeyvSqlite, createKeyv } from "./index";

const sqliteFile = join(process.cwd(), "runtime", "cache.sqlite3");

const store = () => new KeyvSqlite({ uri: sqliteFile, busyTimeout: 3000 });

keyvTestSuite(test, Keyv, store);

let sqliteKeyv: KeyvSqlite;

test.beforeEach(async () => {
  sqliteKeyv = new KeyvSqlite({ uri: sqliteFile, busyTimeout: 3000 });

  await sqliteKeyv.clear();
});

test.it("getMany will return multiple values", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  await sqliteKeyv.set("foo1", "bar1");
  await sqliteKeyv.set("foo2", "bar2");

  const values = await sqliteKeyv.getMany(["foo", "foo1", "foo2"]);
  t.expect(values).toStrictEqual(["bar", "bar1", "bar2"]);
});

test.it("deleteMany will delete multiple records", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  await sqliteKeyv.set("foo1", "bar1");
  await sqliteKeyv.set("foo2", "bar2");

  const values = await sqliteKeyv.getMany(["foo", "foo1", "foo2"]);
  t.expect(values).toStrictEqual(["bar", "bar1", "bar2"]);

  await sqliteKeyv.deleteMany(["foo", "foo1", "foo2"]);
  const values1 = await sqliteKeyv.getMany(["foo", "foo1", "foo2"]);

  t.expect(values1).toStrictEqual([undefined, undefined, undefined]);
});

test.it("Async Iterator single element test", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  const iterator = sqliteKeyv.iterator();

  for await (const [key, raw] of iterator) {
    t.expect(key).toBe("foo");
    t.expect(raw).toBe("bar");
  }
});

test.it("Async Keys single element test", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  const keys = sqliteKeyv.keys();

  for await (const key of keys) {
    t.expect(key).toBe("foo");
  }
});

test.it("Async Iterator multiple element test", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  await sqliteKeyv.set("foo1", "bar1");
  await sqliteKeyv.set("foo2", "bar2");

  const expectedEntries = [
    ["foo", "bar"],
    ["foo1", "bar1"],
    ["foo2", "bar2"],
  ];
  const iterator = sqliteKeyv.iterator();
  let i = 0;
  for await (const [key, raw] of iterator) {
    const [expectedKey, expectedRaw] = expectedEntries[i++];
    t.expect(key).toBe(expectedKey);
    t.expect(raw).toBe(expectedRaw);
  }
});

test.it("Async Keys multiple element test", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  await sqliteKeyv.set("foo1", "bar1");
  await sqliteKeyv.set("foo2", "bar2");

  const expectedKeys = ["foo", "foo1", "foo2"];
  const keys = sqliteKeyv.keys();
  let i = 0;
  for await (const key of keys) {
    const expectedKey = expectedKeys[i++];
    t.expect(key).toBe(expectedKey);
  }
});

test.it("Async Iterator multiple elements with limit=1 test", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  await sqliteKeyv.set("foo1", "bar1");
  await sqliteKeyv.set("foo2", "bar2");
  const iterator = sqliteKeyv.iterator();
  let key = await iterator.next();
  let [k, v] = key.value;
  t.expect(k).toBe("foo");
  t.expect(v).toBe("bar");
  key = await iterator.next();
  [k, v] = key.value;
  t.expect(k).toBe("foo1");
  t.expect(v).toBe("bar1");
  key = await iterator.next();
  [k, v] = key.value;
  t.expect(k).toBe("foo2");
  t.expect(v).toBe("bar2");
});

test.it("Async Keys multiple elements with limit=1 test", async (t) => {
  await sqliteKeyv.set("foo", "bar");
  await sqliteKeyv.set("foo1", "bar1");
  await sqliteKeyv.set("foo2", "bar2");
  const keys = sqliteKeyv.keys();
  let key = await keys.next();
  let k = key.value
  t.expect(k).toBe("foo");
  key = await keys.next();
  k = key.value
  t.expect(k).toBe("foo1");
  key = await keys.next();
  k = key.value
  t.expect(k).toBe("foo2");
});

test.it("Async Iterator 0 element test", async (t) => {
  const iterator = sqliteKeyv.iterator("keyv");
  const key = await iterator.next();
  t.expect(key.value).toBe(undefined);
});

test.it("Async Keys 0 element test", async (t) => {
  const keys = sqliteKeyv.keys("keyv");
  const key = await keys.next();
  t.expect(key.value).toBe(undefined);
});

test.it("Async Keys with pattern test", async (t) => {
  await sqliteKeyv.set("other", "bar");
  await sqliteKeyv.set("foo1", "bar");
  await sqliteKeyv.set("foo2", "bar1");
  await sqliteKeyv.set("foo3", "bar2");

  for await (const key of sqliteKeyv.keys("foo*")) {
    t.expect(key).not.toBe("other");
  }
});

test.it("close connection successfully", async (t) => {
  t.expect(await sqliteKeyv.get("foo")).toBe(undefined);
  await sqliteKeyv.set("foo", "bar");
  t.expect(await sqliteKeyv.get("foo")).toBe("bar");
  await sqliteKeyv.disconnect();
  try {
    await sqliteKeyv.get("foo");
    t.expect.fail();
  } catch {
    t.expect(true).toBeTruthy();
  }
});

test.it("handling namespaces with multiple keyv instances", async (t) => {
  const storeA = new KeyvSqlite({ uri: sqliteFile });
  const storeB = new KeyvSqlite({ uri: sqliteFile });
  const keyvA = new Keyv({ store: storeA, namespace: "ns1" });
  const keyvB = new Keyv({ store: storeB, namespace: "ns2" });

  await keyvA.set("a", "x");
  await keyvA.set("b", "y");
  await keyvA.set("c", "z");

  await keyvB.set("a", "one");
  await keyvB.set("b", "two");
  await keyvB.set("c", "three");

  const resultA = await keyvA.get(["a", "b", "c"]);
  const resultB = await keyvB.get(["a", "b", "c"]);

  t.expect(resultA).toStrictEqual(["x", "y", "z"]);
  t.expect(resultB).toStrictEqual(["one", "two", "three"]);

  const iteratorResultA = new Map<string, string>();

  const iterator1 = keyvA.iterator ? keyvA.iterator("ns1") : undefined;
  if (iterator1) {
    for await (const [key, value] of iterator1) {
      iteratorResultA.set(key, value);
    }
  }

  t.expect(iteratorResultA).toStrictEqual(
    new Map([
      ["a", "x"],
      ["b", "y"],
      ["c", "z"],
    ]),
  );
});

test.it("will create a Keyv instance with a store", (t) => {
  const keyv = createKeyv();
  t.expect(keyv).toBeInstanceOf(Keyv);
});
