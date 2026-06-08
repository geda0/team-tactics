# infra — deploy & release mechanics

Owned by **dev-ops**. Idempotent scripts the PM can re-run after an accepted milestone.

## Private tester tarball

Eval builds for external testers — **not** public npm. Send the `.tgz` over a channel you
control (email, Drive, 1:1). See `FOR-TESTERS.md` for recipient instructions.

### Local (after tag + green suite)

```bash
# 1. Version bump (all four package.json lockstep) + commit
# 2. Tag the accepted commit
git tag -a v0.32.0 -m "v0.32.0"
git push origin v0.32.0

# 3. Build locally (optional — CI does the same on tag push)
REQUIRE_TAG=1 ./infra/release-tarball.sh
# → ./ttics-0.32.0.tgz
```

### CI (automatic on tag push)

Workflow: `.github/workflows/release-tarball.yml`

On `git push origin v*`:

1. `npm ci` + full `npm test`
2. `infra/release-tarball.sh` with `REQUIRE_TAG=1` (tag must match `package.json`)
3. Upload **Actions artifact** `ttics-private-tarball` (90d retention)
4. Attach `ttics-<version>.tgz` to the **GitHub Release** for that tag

**Download (maintainer):** GitHub → Releases → pick tag → Assets, or Actions → workflow run → Artifacts.

**Tester access:** Do **not** grant repo access for eval unless you intend full source read.
Prefer downloading the release asset and sending it privately.

### Scripts

| Script | Purpose |
|--------|---------|
| `release-tarball.sh` | Suite + pack + verify required paths in archive |
| `../scripts/pack-tarball.js` | `git archive` at `v<version>` (or HEAD if untagged) |

### Environment variables

| Var | Default | Meaning |
|-----|---------|---------|
| `REQUIRE_TAG` | `0` | `1` = fail unless `v<package.json version>` exists |
| `TAG_NAME` | — | If set (CI: `github.ref_name`), must equal `v<version>` |
