# Superadmin Password Reset Cheat Sheet

```sql
-- Superadmin password reset
-- STEP 1: Generate a new PBKDF2 hash (see helper below).
-- STEP 2: Paste the full hash string in place of <NEW_HASH>.
-- STEP 3: Make sure the WHERE clause targets your superadmin row exactly.

BEGIN;

UPDATE "Users"
SET
  "password" = '<NEW_HASH>',          -- TODO: replace with pbkdf2$... hash output
  "updatedAt" = NOW()
WHERE
  "email" = 'admin@tagsakay.com'       -- TODO: adjust to the specific account
  AND "role" = 'superadmin';           -- Optional extra safeguard

-- Optional check: confirm the row was updated
SELECT "id", "email", "role", "updatedAt"
FROM "Users"
WHERE "email" = 'admin@tagsakay.com';

COMMIT;
```

```bash
# Helper: generate PBKDF2 hash (run from repo root)
# Replace YourNewSuperadminPassword! with the actual password.
node -e "const crypto=require('crypto');const iterations=100000;const salt=crypto.randomBytes(16);const saltHex=salt.toString('hex');const password=process.argv[1];crypto.pbkdf2(password,salt,iterations,32,'sha256',(err,derived)=>{if(err)throw err;console.log(['pbkdf2',iterations,saltHex,derived.toString('hex')].join('$'));});" "YourNewSuperadminPassword!"
```

**Remember**: Only paste the hash into the SQL script. Do **not** place the plain-text password in the query.
