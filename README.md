# SQLite store for keyv

A new SQLite cache store for [keyv](https://github.com/jaredwray/keyv).

## Featuring:

- using [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- 100% test coverage and production ready

## Installation

```
npm i @resolid/keyv-sqlite
```

## Requirements

- SQLite 3 with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- Node 18+

## Usage

```js
import { KeyvSqlite } from '@resolid/keyv-sqlite';
import Keyv from "keyv";
import { join } from 'node:path';

// SQLite :memory: cache store
const keyv = new Keyv(new KeyvSqlite());

// On disk cache on caches table
const keyv = new Keyv(new KeyvSqlite({uri: join(process.cwd(), 'cache.sqlite3')}));
```

## License

[MIT](./LICENSE).

## Thanks

Thanks to JetBrains for the [OSS development license](https://jb.gg/OpenSourceSupport).

![JetBrain](.github/assets/jetbrain-logo.svg)
