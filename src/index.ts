import EventEmitter from "node:events";
import Database from "better-sqlite3";
import Keyv, { type KeyvStoreAdapter, type StoredData } from "keyv";

type KeyvSqliteOptions = {
  dialect?: string;
  uri?: string;
  table?: string;
  enableWALMode?: boolean;
  busyTimeout?: number;
  iterationLimit?: number | string;
};

type CacheObject = {
  cacheKey: string;
  cacheData: string;
  createdAt: number;
  expiredAt: number;
};

const now = () => {
  return new Date().getTime();
};

export class KeyvSqlite extends EventEmitter implements KeyvStoreAdapter {
  ttlSupport: boolean;
  opts: KeyvSqliteOptions;
  namespace?: string;

  sqlite: ReturnType<typeof Database>;
  fetchCaches: (...args: string[]) => CacheObject[];
  deleteCaches: (...args: string[]) => number;
  updateCatches: (args: [string, unknown][], ttl?: number) => void;
  emptyCaches: () => void;
  findCaches: (namespace: string | undefined, limit: number, offset: number, expiredAt: number) => CacheObject[];

  constructor(options?: KeyvSqliteOptions) {
    super();
    this.ttlSupport = true;
    this.opts = { dialect: "sqlite", table: "caches", busyTimeout: 5000, ...options };
    this.sqlite = new Database(this.opts.uri, { timeout: this.opts.busyTimeout });

    if (this.opts.enableWALMode) {
      this.sqlite.pragma("journal_mode = WAL");
    }

    const tableName = this.opts.table;

    this.sqlite.exec(`
 CREATE TABLE IF NOT EXISTS ${tableName} (
	'cacheKey' TEXT PRIMARY KEY,
	'cacheData' TEXT,
	'createdAt' INTEGER,
  'expiredAt' INTEGER
);
CREATE INDEX IF NOT EXISTS idx_expired_caches ON ${tableName}(expiredAt);
`);

    const selectSingleStatement = this.sqlite.prepare<string, CacheObject>(
      `SELECT * FROM ${tableName} WHERE cacheKey = ?`,
    );
    const selectStatement = this.sqlite.prepare<string, CacheObject>(
      `SELECT * FROM ${tableName} WHERE cacheKey IN (SELECT value FROM json_each(?))`,
    );
    const updateStatement = this.sqlite.prepare(
      `INSERT OR REPLACE INTO ${tableName}(cacheKey, cacheData, createdAt, expiredAt) VALUES (?, ?, ?, ?)`,
    );
    const deleteSingleStatement = this.sqlite.prepare(`DELETE FROM ${tableName} WHERE cacheKey = ?`);
    const deleteStatement = this.sqlite.prepare(
      `DELETE FROM ${tableName} WHERE cacheKey IN (SELECT value FROM json_each(?))`,
    );
    const finderStatement = this.sqlite.prepare<[string, number, number, number], CacheObject>(
      `SELECT * FROM ${tableName} WHERE cacheKey LIKE ? AND (expiredAt = -1 OR expiredAt > ?) LIMIT ? OFFSET ?`,
    );
    const purgeStatement = this.sqlite.prepare(`DELETE FROM ${tableName} WHERE expiredAt != -1 AND expiredAt < ?`);
    const emptyStatement = this.sqlite.prepare(`DELETE FROM ${tableName} WHERE cacheKey LIKE ?`);

    this.fetchCaches = (...args) => {
      const ts = now();
      let purgeExpired = false;

      const result =
        args.length >= 3
          ? selectStatement
              .all(JSON.stringify(args))
              .map((data) => {
                if (data.expiredAt !== -1 && data.expiredAt < ts) {
                  purgeExpired = true;
                  return undefined;
                }
                return data;
              })
              .filter((data) => data !== undefined)
          : args
              .map((key) => {
                const data = selectSingleStatement.get(key);
                if (data !== undefined && data.expiredAt !== -1 && data.expiredAt < ts) {
                  purgeExpired = true;
                  return undefined;
                }

                return data;
              })
              .filter((data) => data !== undefined);

      if (purgeExpired) {
        process.nextTick(() => purgeStatement.run(ts));
      }

      return result as CacheObject[];
    };

    this.deleteCaches = (...args) => {
      if (args.length >= 3) {
        return deleteStatement.run(JSON.stringify(args)).changes;
      }

      let changes = 0;

      for (const k of args) {
        changes += deleteSingleStatement.run(k).changes;
      }

      return changes;
    };

    this.updateCatches = (args, ttl) => {
      const createdAt = now();
      const expiredAt = ttl != undefined && ttl != 0 ? createdAt + ttl * 1000 : -1;

      for (const cache of args) updateStatement.run(cache[0], cache[1], createdAt, expiredAt);
    };

    this.emptyCaches = () => {
      emptyStatement.run(this.namespace ? `${this.namespace}:%` : "%");
    };

    this.findCaches = (namespace, limit, offset, expiredAt) => {
      return finderStatement
        .all(`${namespace ? `${namespace}:` : ""}%`, expiredAt, limit, offset)
        .filter((data) => data !== undefined);
    };
  }

  async get<Value>(key: string): Promise<StoredData<Value> | undefined> {
    const rows = this.fetchCaches(key);

    if (rows.length == 0) {
      return undefined;
    }

    return rows[0].cacheData as Value;
  }

  async getMany<Value>(keys: string[]): Promise<Array<StoredData<Value | undefined>>> {
    const rows = this.fetchCaches(...keys);

    return keys.map((key) => {
      const row = rows.find((row) => row.cacheKey === key);

      return (row ? row.cacheData : undefined) as StoredData<Value | undefined>;
    });
  }

  async set<T>(key: string, value: T, ttl?: number) {
    return new Promise((resolve, reject) => {
      try {
        this.updateCatches([[key, value]], ttl);
        resolve(value);
      } catch (e) {
        reject(e);
      }
    });
  }

  async delete(key: string) {
    const count = this.deleteCaches(key);

    return count == 1;
  }

  async deleteMany(keys: string[]) {
    const count = this.deleteCaches(...keys);

    return count == keys.length;
  }

  async clear() {
    this.emptyCaches();
  }

  async *iterator(namespace?: string) {
    const limit = Number.parseInt(this.opts.iterationLimit! as string, 10) || 10;
    const time = now();
    const find = this.findCaches;

    // @ts-expect-error - iterate
    const iterate = async function* (offset: number) {
      const entries = find(namespace, limit, offset, time);

      if (entries.length === 0) {
        return;
      }

      for (const entry of entries) {
        // biome-ignore lint: <explanation>
        offset += 1;
        yield [entry.cacheKey, entry.cacheData];
      }

      yield* iterate(offset);
    };

    yield* iterate(0);
  }

  async disconnect() {
    this.sqlite.close();
  }
}

export const createKeyv = (keyvOptions?: KeyvSqliteOptions) => new Keyv({ store: new KeyvSqlite(keyvOptions) });
