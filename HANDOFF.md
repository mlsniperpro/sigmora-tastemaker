# Handoff (TASTEMAKER, wound down 2026-10-24 ~22:55 UTC)

Lease released: no background jobs, no scheduled check-ins, `.agent/win/TASTEMAKER/pids` empty.

## State

- Win gate: `GATE: FAIL (5)`. The reaudit.md and break-it.md reports are stale (`AUDITED_COMMIT`/`TESTED_COMMIT` 3b25d12), and the gate needs 2 clean audits in a row on the final commit.
- Re-audit 3 on 4ef5b36 found 0 critical and 2 high. Fixed in this commit:
  - **High 1:** budget. A new run atomically reserves `QLOO_RUN_ESTIMATE` (80) calls with `QlooClient.reserve`, and `release()` refunds whatever it didn't spend. MCP tools reserve too. BLOCKED.md asks the owner for a judging quota.
  - **High 2:** streaming services, social networks and stores are never picks, and names found only by scanning the copy are flagged, never swapped.
  - **Medium 3:** when the Qloo budget runs out mid-critic, picks come back unscored and the plan finishes.
  - **Medium 4:** concurrent admission is handled by the same atomic reservation.
  - **Medium 5:** Qloo calls stop at a run deadline (75 s), including calls queued behind the throttle.
  - **Low 10:** MCP `fresh` now really runs live.

## Next, in order (re-audit 3 leftovers)

1. Medium 6: `"Washington"` in `US_METROS` (src/lib/agent/presets.ts) is ambiguous for `filter.location.query`. Use "Washington, DC" (the simulator has that alias) and check the tests that name "Washington".
2. Medium 7: the "agentic" read. Consider bounded model tool calls (`taste_check` and insights) in the revise round, shown in the trace.
3. Low 8: `decodeURIComponent` on a malformed owner cookie throws, giving a 500 (src/lib/publisher/index.ts `ownerKeyOf`). Wrap it in try/catch and treat a failure as a wrong key.
4. Low 9: owner session. Use an HMAC cookie instead of the raw key, check Origin on the POST routes, and rate-limit `/api/owner`.
5. Low 11: the ROI line ("agency brief takes weeks") needs a source; label recorded durations.
6. Low 12: label custom-brief permalinks "user-submitted brief".
7. Add the B18+ items to WIN-CHECKLIST.md. Then audit twice, soak (scratchpad soak.sh), fresh clone, update reaudit.md and break-it.md, run the gate, and update the PR status.
