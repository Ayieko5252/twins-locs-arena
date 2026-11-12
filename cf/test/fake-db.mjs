// A tiny stand-in for D1, enough to test the rules without a real database.
// It records the statements it was given and answers from canned rows.

export function fakeDb({ rows = {}, accounts = ["1000", "1010", "1020", "1200", "2200", "4000", "4100", "5000", "5900"] } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      const stmt = {
        sql,
        args: [],
        bind(...args) { stmt.args = args; return stmt; },
        async run() { calls.push({ sql, args: stmt.args, kind: "run" }); return { meta: { last_row_id: calls.length } }; },
        async first() {
          calls.push({ sql, args: stmt.args, kind: "first" });
          for (const [match, value] of Object.entries(rows)) if (sql.includes(match)) return typeof value === "function" ? value(stmt.args) : value;
          return null;
        },
        async all() {
          calls.push({ sql, args: stmt.args, kind: "all" });
          if (sql.includes("FROM accounts")) return { results: accounts.map((code) => ({ code })) };
          for (const [match, value] of Object.entries(rows)) if (sql.includes(match)) return { results: typeof value === "function" ? value(stmt.args) : value };
          return { results: [] };
        },
      };
      return stmt;
    },
    async batch(stmts) { calls.push({ kind: "batch", size: stmts.length }); return stmts.map(() => ({})); },
  };
  return db;
}

export const ran = (db, fragment) => db.calls.filter((c) => (c.sql || "").includes(fragment));
