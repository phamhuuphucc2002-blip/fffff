# Arcanum Collaboration V1

## Goal
Allow multiple members to contribute to the same knowledge item without silently overwriting another member's work.

## Data model
Each knowledge item may carry:
- `authorId`: original creator
- `authorName`: display name
- `revision`: monotonically increasing revision number
- `updatedBy`: latest editor
- `updatedAt`: ISO timestamp
- `contributions`: array of contribution records

Each contribution record:
- `id`
- `authorId`
- `authorName`
- `color`
- `type`: `suggestion` | `addition` | `edit`
- `status`: `pending` | `approved` | `rejected`
- `text`
- `createdAt`
- `resolvedAt`
- `resolvedBy`

## Workflow
1. Original author creates knowledge.
2. Another member selects Add suggestion/edit.
3. The contribution is stored separately and is displayed with that member's assigned color.
4. Owner/Admin can approve or reject it.
5. Approval creates a new revision while preserving the previous revision.
6. Rejection preserves the audit trail but does not modify the main content.

## Color assignment
Colors are presentation metadata only. Authorization is always enforced server-side by membership role.

## Safety
Never replace the current knowledge body solely because a client has stale data. Use workspace/item revision checks and return HTTP 409 on conflicts.

## Planned API
- `POST /api/workspaces/:id/contributions`
- `GET /api/workspaces/:id/contributions`
- `POST /api/workspaces/:id/contributions/:contributionId/approve`
- `POST /api/workspaces/:id/contributions/:contributionId/reject`
- `GET /api/workspaces/:id/revisions`

## UI states
- Original content: default text
- Pending contribution: contributor color + `Đề xuất bởi ...`
- Approved: merged into current revision, history retained
- Rejected: muted contributor color + `Đã từ chối`
