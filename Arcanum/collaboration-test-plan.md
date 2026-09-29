# Arcanum Collaboration V1 — Verification Plan

## 1. Identity
- Register two accounts A and B.
- Verify each receives a different authenticated identity.

## 2. Workspace isolation
- A creates a workspace.
- B joins using the join code.
- Verify B cannot access an unrelated workspace.

## 3. Contribution flow
- A creates knowledge item X.
- B creates a suggestion for X.
- Verify A's original text is unchanged.
- Verify B's text is shown with B's contributor color and pending status.

## 4. Moderation
- Owner/Admin approves B's suggestion.
- Verify a new revision is created.
- Verify the previous revision remains available.
- Reject a second suggestion and verify it does not alter the main content.

## 5. Concurrent editing
- A and B load the same revision.
- A saves first.
- B submits stale revision.
- Server must return conflict (409) and current data; it must not overwrite A.

## 6. Authorization
- Member attempts to approve another member's suggestion.
- Server must reject unless role permits moderation.
- Viewer attempts to edit or contribute.
- Server must reject.

## 7. Persistence
- Restart/redeploy the service.
- Verify cloud data remains when PostgreSQL is configured.
- If PostgreSQL is unavailable in production, surface a clear cloud-storage error rather than silently claiming cloud sync.

## 8. Mobile
- Test login, contribution, approval, pull, push and conflict UI on Android viewport.
