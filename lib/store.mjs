import { DatabaseSync } from 'node:sqlite';

export function createStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
  db.prepare('INSERT OR IGNORE INTO workspace VALUES (1, ?)').run(JSON.stringify({ projects: [] }));
  const select = db.prepare('SELECT data FROM workspace WHERE id = 1');
  const update = db.prepare('UPDATE workspace SET data = ? WHERE id = 1');
  const read = () => JSON.parse(select.get().data);
  return {
    read,
    write(change) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const data = read();
        const result = change(data);
        update.run(JSON.stringify(data));
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close()
  };
}
