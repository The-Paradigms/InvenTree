import sqlite3
conn = sqlite3.connect("db/data.sqlite3")
tables = [t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print(f"{len(tables)} tables found")
print('\n'.join(sorted(tables)[:20]))
