# Security Policy

## Reporting a vulnerability

Please email the maintainers privately rather than opening a public issue.
Include reproduction steps and the smallest test case you can.

## Never commit secrets

The following must **never** appear in source, docs, commit messages, issues,
PRs, screenshots, or chat logs:

- Database connection strings with credentials (`postgres://user:pass@...`)
- API keys (OpenAI, Anthropic, Stripe, etc.)
- JWT signing secrets, session secrets, webhook signing secrets
- Private keys (`*.pem`, `*.key`), service-account JSON, OAuth client secrets
- SMTP / email credentials, cloud-provider access keys

Use placeholders in examples, e.g. `postgresql://<user>:<password>@<host>:<port>/<db>`.

### Internal metrics endpoint

The new backend exposes `GET /pool-stats` for ops monitoring. Because it
reveals connection-pool internals, it is gated by a shared key:

- Set `INTERNAL_METRICS_KEY` (≥16 chars, ≥32 random bytes recommended) in
  the production secret manager. **Do not commit it.**
- Callers must send `x-metrics-key: <value>`.
- Fail-closed: if `INTERNAL_METRICS_KEY` is unset, every request to
  `/pool-stats` returns `401 { code: "UNAUTHORIZED" }`.
- Comparison is constant-time; the key is never logged.

Example:

```bash
curl -H "x-metrics-key: $INTERNAL_METRICS_KEY" \
  https://<host>/pool-stats
```

If/when admin auth lands in the new backend, replace this middleware with
a `requireAdmin` guard.

### How we store secrets

| Environment | Mechanism |
| --- | --- |
| Local dev | `.env` file (gitignored), copied from `.env.example` |
| Production | Hosting-provider secret manager (Render env vars, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Fly secrets, Vercel env vars) |
| CI | GitHub Actions `secrets.*` |

Application code reads secrets from `process.env.*` only. There are no
hardcoded fallbacks for production credentials.

## Preventative controls

This repository enforces:

- **`.gitignore`** — blocks `.env`, `.env.*`, `*.pem`, `*.key`, `credentials.json`, etc.
- **`gitleaks`** — config at `.gitleaks.toml`.
  - Runs on every push & PR via `.github/workflows/secret-scan.yml`.
  - Runs locally via `pre-commit` (`.pre-commit-config.yaml`).
- **Weekly scheduled full-history scan** to catch anything missed.

### Enable the local pre-commit hook

```bash
pip install pre-commit          # or: brew install pre-commit
pre-commit install              # installs the git hook
pre-commit run --all-files      # one-off sweep of the working tree
```

If gitleaks blocks a commit, **do not** bypass it with `--no-verify`. Remove
the secret, rotate it (see below), and recommit.

---

## Remediation Checklist — credential exposure

Use this when a secret has been (or might have been) committed, pushed,
shared, screenshotted, or pasted publicly. **Assume compromise.**

### 0. Triage (first 5 minutes)
- [ ] Confirm what leaked, where, and for how long (commit SHA, file, line).
- [ ] Identify every system the credential grants access to.
- [ ] Open an internal incident ticket; assign one driver.

### 1. Rotate immediately (do this first — even before history rewrite)
History rewrites do not invalidate credentials that already exist. **Rotate first.**

- [ ] **Database password:** rotate via the hosting provider.
  - Render: *Dashboard → Database → Connection → Rotate password*.
  - AWS RDS: `ModifyDBInstance --master-user-password ...` then update secret in Secrets Manager.
  - GCP Cloud SQL: `gcloud sql users set-password ...`.
- [ ] Update the new value in the **secret manager** for every environment
      (prod, staging, CI).
- [ ] Redeploy / restart services so they pick up the new value.
- [ ] Revoke any other credentials co-located with the leak (API keys, JWT
      secret, Stripe keys, OpenAI/Anthropic keys, SMTP password).

### 2. Audit for misuse
- [ ] Pull database audit logs / connection logs for the exposure window.
- [ ] Look for unfamiliar source IPs, geographic anomalies, off-hours access,
      bulk reads/exports, schema changes, new roles/users.
- [ ] Check provider access logs (Render, AWS CloudTrail, GCP Audit Logs).
- [ ] If misuse is suspected: snapshot the DB, preserve logs, escalate per
      your incident-response policy.

### 3. Purge git history (after rotation)

> ⚠️ Rewriting history changes commit SHAs. Coordinate with everyone who has
> a clone. Anyone with an existing clone must reclone or hard-reset.

**Option A — `git filter-repo` (recommended, modern replacement for filter-branch):**

```bash
# Install
pip install git-filter-repo

# Work on a fresh mirror clone
git clone --mirror git@github.com:mothuuu/ai-visibility-tool.git
cd ai-visibility-tool.git

# Strip the leaked literal from all blobs (use the literal value once, locally)
cat > /tmp/leaked.txt <<'EOF'
postgresql://<paste-leaked-value-here>
EOF
git filter-repo --replace-text /tmp/leaked.txt
shred -u /tmp/leaked.txt   # delete local copy of the secret

# Or remove the entire offending file from history if appropriate:
# git filter-repo --invert-paths --path RUN_MIGRATION.md

# Force-push the rewritten history (requires admin / branch-protection bypass)
git push --force --all
git push --force --tags
```

**Option B — BFG Repo-Cleaner:**

```bash
git clone --mirror git@github.com:mothuuu/ai-visibility-tool.git
java -jar bfg.jar --replace-text leaked.txt ai-visibility-tool.git
cd ai-visibility-tool.git
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force --all
git push --force --tags
```

### 4. Post-purge cleanup
- [ ] Tell every collaborator to reclone (their old clones still contain the secret).
- [ ] Invalidate any cached copies: GitHub forks, mirrors, archive sites,
      CI build caches, container images, backups.
- [ ] If the repo is/was public, **assume the secret was scraped** — rotation
      in step 1 is non-negotiable.
- [ ] Run `gitleaks detect --source . --log-opts=--all` to verify a clean tree.
- [ ] Close the incident ticket with a short post-mortem (what leaked, blast
      radius, fix, prevention).

### 5. Prevent recurrence
- [ ] Confirm `.gitignore`, `.gitleaks.toml`, the CI workflow, and the
      pre-commit hook are all in place on `main`.
- [ ] Require status checks (`Secret Scan / gitleaks`) on protected branches.
- [ ] Add code-review guidance: reviewers reject any PR containing literal
      hostnames + credentials in docs or scripts.
